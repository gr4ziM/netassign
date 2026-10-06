#!/usr/bin/python3
"""NetAssign CGI: the only bridge between the UI and the root helper.

Runs as the unprivileged package user (DSM executes package CGIs through
synoscgi). Every call must come from a signed-in DSM administrator:
the session cookie and SynoToken are checked with DSM's own
authenticate.cgi, and the user must be in the "administrators" group.

GET  ?action=helper                 helper heartbeat (is it registered/running?)
POST action=submit&request=<name>[&params=<json>]
                                    queue a request for the root helper
GET  ?action=result&id=<id>         fetch a request's result (or pending)

Python 3.8, standard library only.
"""

import grp
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

VAR = Path("/var/packages/NetAssign/var")
REQUESTS = VAR / "requests"
RESULTS = VAR / "results"
HEARTBEAT = VAR / "helper.json"
AUTHENTICATE = "/usr/syno/synoman/webman/modules/authenticate.cgi"
REQUEST_ID = re.compile(r"^[0-9a-f]{32}$")
# Must match the helper's ACTIONS; the helper re-validates regardless.
SUBMITTABLE = {"status", "subif_apply", "subif_remove", "apply_batch", "confirm", "revert"}
HEARTBEAT_STALE_SECONDS = 15


def respond(status, payload):
    body = json.dumps(payload)
    sys.stdout.write(
        "Status: %s\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n\r\n%s"
        % (status, body)
    )
    sys.stdout.flush()
    sys.exit(0)


def params():
    query = dict(urllib.parse.parse_qsl(os.environ.get("QUERY_STRING", "")))
    if os.environ.get("REQUEST_METHOD") == "POST":
        length = int(os.environ.get("CONTENT_LENGTH") or 0)
        if length > 64 * 1024:          # matches the helper's MAX_REQUEST_BYTES
            respond("413 Payload Too Large", {"error": "request too large"})
        query.update(dict(urllib.parse.parse_qsl(sys.stdin.read(length))))
    return query


def authenticated_user(query):
    token = os.environ.get("HTTP_X_SYNO_TOKEN") or query.get("SynoToken") or ""
    env = dict(os.environ)
    env["QUERY_STRING"] = "SynoToken=" + urllib.parse.quote(token)
    try:
        p = subprocess.run(
            [AUTHENTICATE], env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=10, universal_newlines=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = [line.strip() for line in p.stdout.splitlines() if line.strip()]
    return lines[-1] if p.returncode == 0 and lines else None


def is_admin(user):
    try:
        return user in grp.getgrnam("administrators").gr_mem
    except KeyError:
        return False


def read_json(path):
    try:
        with open(str(path)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def main():
    query = params()
    user = authenticated_user(query)
    if not user:
        respond("401 Unauthorized", {"error": "no valid DSM session"})
    if not is_admin(user):
        respond("403 Forbidden", {"error": "administrator account required", "user": user})

    action = query.get("action")
    if action == "helper":
        hb = read_json(HEARTBEAT)
        alive = bool(hb) and time.time() - float(hb.get("heartbeat", 0)) < HEARTBEAT_STALE_SECONDS
        respond("200 OK", {"user": user, "registered": hb is not None, "alive": alive, "heartbeat": hb})

    if action == "submit":
        if os.environ.get("REQUEST_METHOD") != "POST":
            respond("405 Method Not Allowed", {"error": "submit requires POST"})
        name = query.get("request")
        if name not in SUBMITTABLE:
            respond("400 Bad Request", {"error": "unknown request %r" % name})
        if not REQUESTS.is_dir():
            respond("409 Conflict", {"error": "the root helper has never run; register it in Task Scheduler first"})
        try:
            req_params = json.loads(query.get("params") or "{}")
        except ValueError:
            respond("400 Bad Request", {"error": "params is not valid JSON"})
        if not isinstance(req_params, dict):
            respond("400 Bad Request", {"error": "params must be a JSON object"})
        # Where this admin session connects from/to, for the helper's
        # lock-out check. Set here, never taken from the browser.
        req_params["origin"] = {
            "client": os.environ.get("REMOTE_ADDR"),
            "server_addr": os.environ.get("SERVER_ADDR"),
            "server_port": os.environ.get("SERVER_PORT"),
        }
        rid = secrets.token_hex(16)
        # The helper validates params itself; the CGI only forwards them.
        payload = {"id": rid, "action": name, "params": req_params, "user": user, "submitted": time.time()}
        tmp = REQUESTS / (".%s.tmp" % rid)
        with open(str(tmp), "x") as f:
            json.dump(payload, f)
        os.replace(str(tmp), str(REQUESTS / ("%s.json" % rid)))
        respond("202 Accepted", {"id": rid})

    if action == "result":
        rid = query.get("id", "")
        if not REQUEST_ID.match(rid):
            respond("400 Bad Request", {"error": "invalid id"})
        result = read_json(RESULTS / ("%s.json" % rid))
        respond("200 OK", result if result is not None else {"id": rid, "pending": True})

    respond("400 Bad Request", {"error": "unknown action %r" % action})


if __name__ == "__main__":
    main()
