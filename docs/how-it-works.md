# How NetAssign works

## Architecture

```
DSM desktop (administrator session)
 └─ NetAssign window (iframe: app/index.html)
     ├─ reads status via DSM Web API (/webapi/entry.cgi, session + SynoToken)
     └─ changes via app/api.cgi  ── runs as package user, admins only
            │  writes request file
            ▼
   /var/packages/NetAssign/var/requests/   ◄── result files ──┐
            │                                                  │
            ▼                                                  │
   netassign-helper (root daemon, root-owned copy) ────────────┘
       ├─ ovs-vsctl / ip      → VLAN sub-interfaces, route tables
       ├─ iptables            → NETASSIGN chain (service restrictions)
       └─ synowebapi          → read-only checks
```

- **The UI** shares the administrator's DSM session. It reads
  everything through DSM's Web API, the same way DSM's own apps do.
- **`api.cgi`** is the only bridge to the helper. DSM runs it as the
  unprivileged package user. It accepts only signed-in members of the
  `administrators` group, which it checks with DSM's own
  `authenticate.cgi`.
- **The helper** is a small Python daemon (DSM's built-in Python 3,
  standard library only). It processes one request at a time.

## What changes on the system

### VLAN sub-interfaces

For a tagged network, e.g. VLAN 131 on `ovs_eth0`, the helper creates:

| Item | Example |
|---|---|
| Open vSwitch internal port with the VLAN tag, on the port's existing bridge | `na0v131`, `tag=131`, bridge `ovs_eth0` |
| The address on that port | `192.168.131.21/24` |
| A route table for that address | table `20131` (20000 + VLAN): the subnet and, if set, a default route via the network's gateway |
| A policy rule | `from 192.168.131.21 lookup 20131`, priority 900 |

The policy rule makes replies from that address leave through its own
VLAN, the same way DSM handles its own interfaces with per-address
tables. DSM's own ports, tables and rules are not modified.

### Service restrictions

A dedicated iptables chain `NETASSIGN` is jumped to from `INPUT`. DSM
may move that jump into its own `DEFAULT_INPUT` chain, which is just as
effective. Inside the chain:

1. Loopback traffic and `ESTABLISHED,RELATED` traffic return
   immediately. Replies to the NAS's own outbound connections are never
   affected.
2. For every restricted service and every network NetAssign knows,
   which are Open vSwitch bridges, plain `ethN`/`bondN` ports and
   managed sub-interfaces:
   - On an allowed network without a source list: nothing, the port is
     reachable.
   - On an allowed network with a source list: `RETURN` for each
     source, then `DROP`.
   - On any other network: `DROP`.
3. Everything else falls through unchanged. **The default is allow.**

Docker's own bridge and other interfaces NetAssign doesn't know are
not filtered. Restrictions are IPv4 only.

### Persistence and drift

- The desired state is stored in `/usr/local/etc/netassign/state.json`.
  This directory is root-only.
- At boot, the Task Scheduler task starts the helper. It recreates
  missing sub-interfaces and the chain.
- Every 30 seconds the helper checks:
  - that each managed sub-interface still has its address and policy
    rule,
  - that the chain is still referenced and unchanged.

  If not, it re-applies them. DSM rebuilds networking and iptables on
  various occasions, such as firewall toggles or interface changes.

### Changes, snapshots and revert

Every Apply or Apply all is one batch. For each batch, the helper:

1. **Validates the whole resulting state first:**
   - bridges exist,
   - VLAN IDs are valid,
   - no address or subnet conflicts, also within the batch,
   - port lists are valid,
   - referenced networks exist,
   - the administrator's own connection stays allowed.
2. **Takes a snapshot** of OVS, addresses, routes, rules and iptables:
   `/usr/local/etc/netassign/snapshots/`, the last 30 are kept.
3. **Applies** in a safe order: sub-interface removals, then additions,
   then the firewall chain. If any step fails, it rolls everything
   back.
4. **Records a pending change** with a deadline of 5 minutes.
   - **Confirm** clears it.
   - **Revert**, or reaching the deadline, undoes it: removes what was
     added, restores what was removed, restores the previous
     restrictions.

## Security model

| Concern | Measure |
|---|---|
| Packages must not run as root (DSM 7) | The package runs as its own user. Root work is done by a helper that the administrator installs explicitly. |
| Package files are writable by the package user | Root never executes the package's copy. `install` copies the helper to `/usr/local/libexec/netassign/` (root:root, 0755). The helper refuses to start from anywhere else, or if its file or directory is writable by anyone but root. It never reloads package code by itself. |
| Who may trigger changes | `api.cgi` accepts only signed-in DSM administrators: session cookie plus SynoToken, verified by DSM's `authenticate.cgi`, plus membership in `administrators`. |
| Untrusted request files | The exchange directory is writable by the package user. The helper treats every request as untrusted: size limit, ID format, action allowlist, strict validation of every parameter, `O_NOFOLLOW` on read. Results are written to a fresh `O_EXCL` temp file, owned through its file descriptor and renamed into place. The real `var/` path is resolved once and must sit in a root-only parent. |
| Locking yourself out | `api.cgi` passes the session's client address, server address and port, set server-side, never taken from the browser. The helper refuses firewall states that would drop that connection. Unconfirmed changes revert after 5 minutes. |
| Root-only data | State, pending change, snapshots: `/usr/local/etc/netassign/` (0700). Log: `/var/log/netassign-helper.log`. Lock and PID: `/run`. |
| DSM request signing | NetAssign does not reimplement DSM's signed requests (`X-SYNO-HASH`). Privileged work uses DSM's own tools: `ovs-vsctl`, `ip`, `iptables`, `synowebapi`. |

## Files and paths

| Path | Owner | Purpose |
|---|---|---|
| `/var/packages/NetAssign/target/ui/` | package | UI, DSM integration, `app/api.cgi` |
| `/var/packages/NetAssign/target/bin/netassign-helper` | package | Source for `install`; never run by root during operation |
| `/var/packages/NetAssign/var/requests/`, `results/`, `helper.json` | package | Request/result exchange, helper heartbeat |
| `/usr/local/libexec/netassign/netassign-helper` | root | The helper root actually runs |
| `/usr/local/etc/netassign/` | root | `state.json`, `pending.json`, `snapshots/` |
| `/var/log/netassign-helper.log` | root | Helper log |
