/*
 * NetAssign root-helper integration:
 *   - "Helper" tab: helper state, one-time setup, read-only check,
 *     sub-interfaces NetAssign manages.
 *   - Pending-change banner (all tabs): countdown until the helper
 *     reverts an unconfirmed change on its own, with Confirm/Revert.
 *   - submit()/apply() used by the Plan tab's "Apply" buttons.
 * Every request goes through api.cgi, which checks the DSM
 * administrator session; the helper validates every request again.
 */
(function () {
  "use strict";

  const PACKAGE_COPY = "/var/packages/NetAssign/target/bin/netassign-helper";
  const INSTALLED_COPY = "/usr/local/libexec/netassign/netassign-helper";
  const RESULT_TIMEOUT_MS = 60000;
  const STATE_CHANGING = new Set(["apply_batch", "confirm", "revert", "subif_apply", "subif_remove"]);

  const state = { info: null, error: null, busy: null, result: null, mockPending: null, mockManaged: [], mockFirewall: {} };
  let pollTimer = null;
  let tickTimer = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------ transport

  async function cgi(method, params) {
    const ui = window.NA_UI;
    const headers = {};
    if (ui.token) headers["X-SYNO-TOKEN"] = ui.token;
    const qs = new URLSearchParams(params);
    const opts = { method, credentials: "same-origin", headers };
    let url = "api.cgi";
    if (method === "GET") url += "?" + qs;
    else {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      opts.body = qs;
    }
    const r = await fetch(url, opts);
    let body = null;
    try {
      body = await r.json();
    } catch (e) {
      throw new Error(`api.cgi returned HTTP ${r.status} without JSON — DSM may not execute the package CGI.`);
    }
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  }

  // Local preview only: imitates the helper's batch/confirm/revert state.
  function mockSubmit(request, params) {
    const now = Date.now() / 1000;
    if (request === "apply_batch") {
      const before = state.mockManaged.slice();
      const fwBefore = { ...state.mockFirewall };
      for (const o of params.ops) {
        if (o.op === "subif_remove") state.mockManaged = state.mockManaged.filter((m) => m.key !== o.key);
        else if (o.op === "subif_add") state.mockManaged.push({ key: `${o.bridge}.${o.vlan}`, bridge: o.bridge, vlan: o.vlan, ifname: `na0v${o.vlan}`, address: o.address, gateway: o.gateway, table: 20000 + o.vlan });
        else if (o.op === "fw_clear") delete state.mockFirewall[o.service];
        else if (o.op === "fw_set") state.mockFirewall[o.service] = { service: o.service, ports: o.ports, mode: o.mode, networks: o.networks, sources: o.sources };
      }
      const keys = params.ops.map((o) => o.key || o.service || `${o.bridge}.${o.vlan}`);
      state.mockPending = { kind: "batch", key: keys.join(", "), label: params.label, deadline: now + 300, before, fwBefore };
    }
    if (request === "revert" && state.mockPending) {
      state.mockManaged = state.mockPending.before;
      state.mockFirewall = state.mockPending.fwBefore;
    }
    if (request === "confirm" || request === "revert") state.mockPending = null;
    return {
      ok: true, action: request, helper_version: "mock", started: now - 0.3, finished: now,
      data: request === "status"
        ? {
            ip_addr: { argv: ["ip", "-4", "-o", "addr", "show"], exit_code: 0, stdout: "6: ovs_eth0    inet 192.168.100.21/24 ...", stderr: "" },
            synowebapi_ethernet: { argv: ["synowebapi", "--exec"], exit_code: 1, stdout: "", stderr: "mock failure" },
          }
        : { mock: true, request, params },
    };
  }

  // Queue a request and wait for its result.
  async function submit(request, params) {
    if (window.NA_UI.mock) return mockSubmit(request, params || {});
    const { id } = await cgi("POST", { action: "submit", request, params: JSON.stringify(params || {}) });
    const deadline = Date.now() + RESULT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(1000);
      const r = await cgi("GET", { action: "result", id });
      if (!r.pending) return r;
    }
    return { ok: false, action: request, error: "No answer from the helper within 60 s." };
  }

  // ------------------------------------------------------------ state

  function heartbeat() {
    return (state.info && state.info.heartbeat) || null;
  }

  function outdated(info) {
    const hb = info && info.heartbeat;
    return !!(hb && hb.version && hb.package_version && hb.version !== hb.package_version);
  }

  // Can the Plan tab offer `action` right now? Returns null or the reason why not.
  function blockedReason(action) {
    const info = state.info;
    if (!info || !info.alive) return "the root helper is not running (Helper tab)";
    if (outdated(info)) return "the root helper is outdated (Helper tab)";
    if (!(info.heartbeat.actions || []).includes(action)) return `the running helper does not support ${action}`;
    if (info.heartbeat.pending) return "another change is waiting for confirmation";
    if (state.busy) return "a request is in progress";
    return null;
  }

  async function refresh() {
    safeRender();
    if (window.NA_UI.mock) {
      if (!state.mockSeeded) {
        // Optional mock/helper-state.json: {"managed": [...], "firewall": {...}}
        // as the helper's starting state.
        state.mockSeeded = true;
        try {
          const r = await fetch("mock/helper-state.json", { cache: "no-store" });
          if (r.ok) {
            const seed = await r.json();
            state.mockManaged = seed.managed || [];
            state.mockFirewall = seed.firewall || {};
          }
        } catch (e) {
          // No seed file — start empty.
        }
      }
      const alive = new URLSearchParams(location.search).get("helper") === "alive";
      const now = Date.now() / 1000;
      state.info = alive
        ? {
            registered: true, alive: true, user: "mock",
            heartbeat: {
              pid: 1, version: "mock", package_version: "mock", started: now - 60, heartbeat: now,
              actions: ["status", "subif_apply", "subif_remove", "apply_batch", "confirm", "revert"],
              managed: state.mockManaged, firewall: state.mockFirewall, pending: state.mockPending,
            },
          }
        : { registered: false, alive: false, heartbeat: null, user: "mock" };
    } else {
      try {
        state.info = await cgi("GET", { action: "helper" });
        state.error = null;
      } catch (e) {
        state.info = null;
        state.error = e.message || String(e);
      }
    }
    schedulePolling();
    safeRender();
    if (window.NA_ASSIGN) window.NA_ASSIGN.rerender();
  }

  // Poll while a change is pending so the banner follows the helper.
  function schedulePolling() {
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    const hb = heartbeat();
    if (hb && hb.pending) {
      pollTimer = setTimeout(refresh, 5000);
      tickTimer = setInterval(renderBanner, 1000);
    }
  }

  async function run(label, request, params) {
    state.busy = label;
    safeRender();
    if (window.NA_ASSIGN) window.NA_ASSIGN.rerender();   // disable Apply buttons while busy
    let result;
    try {
      result = await submit(request, params);
    } catch (e) {
      result = { ok: false, action: request, error: e.message || String(e) };
    }
    state.busy = null;
    state.result = result;
    // Once a change has run, reload everything — DSM settings, helper
    // state, every tab — so all views show the new live state. A
    // read-only check only needs the helper state.
    if (STATE_CHANGING.has(request) && window.NA_APP) await window.NA_APP.refresh();
    else await refresh();
    return result;
  }

  // Used by the Assignment tab (per-row Apply and Apply all).
  // `label`: human-readable name of the change, shown in the banner.
  async function applyBatch(ops, label, question) {
    const ok = window.confirm(
      `${question}\n\nA snapshot is taken first. The change reverts automatically after 5 minutes unless you confirm it in the banner.`
    );
    if (!ok) return null;
    return run("Applying…", "apply_batch", { ops, label });
  }

  // ------------------------------------------------------------ rendering

  function fmtLeft(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function age(ts) {
    const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
    return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
  }

  // The banner lives in the Assignment tab (assign.js renders the slot).
  function renderBanner() {
    const el = document.getElementById("pending");
    if (!el) return;
    const hb = heartbeat();
    const p = hb && hb.pending;
    if (!p) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    const { h } = window.NA_UI;
    const left = p.deadline - Date.now() / 1000;
    el.hidden = false;
    el.replaceChildren(
      h("div", null,
        h("strong", null, `Pending change: ${p.label || p.key}`),
        ` (${p.kind}) — reverts automatically in ${fmtLeft(left)} unless you confirm it. ` +
          "Confirm only once you have checked that everything you need is still reachable."),
      h("div", { class: "toolbar", style: "margin:8px 0 0" },
        h("button", { type: "button", class: "primary", disabled: !!state.busy || null, onclick: () => run("Confirming…", "confirm") }, "Confirm — keep it"),
        h("button", { type: "button", disabled: !!state.busy || null, onclick: () => run("Reverting…", "revert") }, "Revert now"))
    );
  }

  function renderSetup(h, isOutdated) {
    return h(
      "div",
      { class: "card" },
      h("h3", null, isOutdated ? "Update the helper" : "One-time setup"),
      h(
        "p",
        null,
        "DSM 7 packages cannot run as root, so changes are carried out by a small root helper. " +
          "It only executes requests that NetAssign queues after checking your administrator session. " +
          "Package files belong to the unprivileged package user, so root runs a separate copy that only root can modify."
      ),
      h(
        "ol",
        null,
        h(
          "li",
          null,
          isOutdated
            ? "After every NetAssign update, install the new helper copy as root (SSH), which also restarts it:"
            : "Install the root-owned helper copy and start it — once, as root over SSH:",
          h("pre", { class: "mono" }, `${PACKAGE_COPY} install`)
        ),
        isOutdated
          ? null
          : [
              h("li", null, "So it starts at every boot: Control Panel → Task Scheduler → Create → Triggered Task → User-defined script."),
              h("li", null, "General: task name ", h("strong", null, "NetAssign helper"), ", user ", h("strong", null, "root"), ", event ", h("strong", null, "Boot-up"), ", enabled."),
              h("li", null, "Task Settings → Run command:", h("pre", { class: "mono" }, `${INSTALLED_COPY} start`)),
            ]
      )
    );
  }

  function renderManaged(h, ui) {
    const hb = heartbeat();
    const managed = (hb && hb.managed) || [];
    const policies = (hb && hb.firewall) || {};
    return [
      h("h2", null, "Sub-interfaces managed by NetAssign"),
      managed.length
        ? ui.table(
            ["Network", "Interface", "VLAN", "Address", "Gateway", "Route table"],
            managed.map((m) => [
              h("span", { class: "mono" }, m.key),
              h("span", { class: "mono" }, m.ifname),
              m.vlan,
              h("span", { class: "mono" }, m.address),
              h("span", { class: "mono" }, m.gateway || "–"),
              m.table,
            ])
          )
        : h("p", { class: "muted" }, "None yet."),
      h("h2", null, "Service restrictions (firewall)"),
      Object.keys(policies).length
        ? ui.table(
            ["Service", "Ports", "Reachable on", "Sources"],
            Object.values(policies).map((p) => [
              h("span", { class: "mono" }, p.service),
              h("span", { class: "mono" }, p.ports.map((x) => `${x.ports}/${x.proto}`).join(", ")),
              p.mode === "blocked" ? "nowhere" : p.mode === "any" ? "all networks" : h("span", { class: "mono" }, p.networks.join(", ")),
              p.mode === "blocked" ? "–" : h("span", { class: "mono" }, p.sources.length ? p.sources.join(", ") : "any"),
            ])
          )
        : h("p", { class: "muted" }, "None — every service is reachable on every network."),
      h("p", { class: "muted" }, "Change sub-interfaces and service assignments in the Assignment tab."),
    ];
  }

  function copyText(text, container) {
    const fallback = () => {
      const ta = window.NA_UI.h("textarea", { class: "mono", rows: 12, readonly: true }, text);
      container.replaceChildren(ta);
      ta.select();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => container.replaceChildren(window.NA_UI.badge("copied", "ok")),
        fallback
      );
    } else fallback();
  }

  function renderOutput(h, ui, name, out) {
    return h(
      "details",
      { class: "card", open: out.exit_code !== 0 || null },
      h(
        "summary",
        null,
        h("strong", { class: "mono" }, name),
        out.exit_code === 0 ? ui.badge("exit 0", "ok") : ui.badge(`exit ${out.exit_code}`, "bad"),
        h("span", { class: "muted mono" }, (out.argv || []).join(" "))
      ),
      h("pre", { class: "mono output" }, out.stdout || "(no output)"),
      out.stderr ? h("pre", { class: "mono output err" }, out.stderr) : null
    );
  }

  function renderResult(h, ui) {
    const r = state.result;
    if (!r) return null;
    const copySlot = h("span");
    const header = h(
      "div",
      { class: "toolbar" },
      h("h2", { style: "margin:0" }, `Last result: ${r.action || "request"}`),
      r.ok ? ui.badge("ok", "ok") : ui.badge("failed", "bad"),
      h("button", { type: "button", onclick: () => copyText(JSON.stringify(r, null, 1), copySlot) }, "Copy as text"),
      copySlot
    );
    if (!r.ok) return [header, h("p", { class: "notice" }, r.error)];
    const data = r.data || {};
    const outputs = [];
    // status: {name: output}; apply/remove: {steps: [output], verify: {name: output}}
    if (data.steps || data.verify) {
      (data.steps || []).forEach((o, i) => outputs.push(renderOutput(h, ui, `step ${i + 1}`, o)));
      Object.entries(data.verify || {}).forEach(([n, o]) => outputs.push(renderOutput(h, ui, `verify: ${n}`, o)));
    } else {
      Object.entries(data).forEach(([n, o]) => {
        if (o && typeof o === "object" && "exit_code" in o) outputs.push(renderOutput(h, ui, n, o));
      });
    }
    return [
      header,
      h("p", { class: "muted" }, `Helper ${r.helper_version} answered in ${Math.round((r.finished - r.started) * 1000)} ms.`),
      ...outputs,
    ];
  }

  function render() {
    const ui = window.NA_UI;
    const { h, badge, kv } = ui;
    const el = document.getElementById("tab-helper");
    const info = state.info;
    let status;
    if (state.error) status = [badge("unreachable", "bad"), ` ${state.error}`];
    else if (!info) status = badge("checking…");
    else if (info.alive && outdated(info)) status = [badge("outdated", "warn"), ` Helper ${info.heartbeat.version}, package ${info.heartbeat.package_version}.`];
    else if (info.alive) status = badge("running", "ok");
    else if (info.registered) status = [badge("not running", "bad"), " Last heartbeat " + age(info.heartbeat.heartbeat) + ". Run the Task Scheduler task again."];
    else status = badge("not set up", "warn");

    const hb = info && info.heartbeat;
    const children = [
      h("h2", null, "Root helper"),
      h(
        "div",
        { class: "card" },
        kv([
          ["Status", h("span", null, status)],
          hb ? ["Version", hb.version] : null,
          hb ? ["Running since", new Date(hb.started * 1000).toLocaleString()] : null,
          hb ? ["Actions", (hb.actions || []).join(", ")] : null,
          info ? ["Signed in as", info.user] : null,
        ]),
        h(
          "div",
          { class: "toolbar", style: "margin-top:10px" },
          h("button", { type: "button", onclick: refresh }, "Check again"),
          h(
            "button",
            { type: "button", disabled: !(info && info.alive) || !!state.busy || null, onclick: () => run("Running read-only check…", "status") },
            "Run read-only check"
          ),
          state.busy ? h("span", { class: "muted" }, state.busy) : null
        )
      ),
      info && info.alive && !outdated(info) ? null : renderSetup(h, !!(info && info.alive)),
      ...(info && info.alive ? renderManaged(h, ui) : []),
      ...[].concat(renderResult(h, ui) || []),
      h(
        "details",
        { class: "card" },
        h("summary", null, h("strong", null, "Uninstalling NetAssign")),
        h(
          "p",
          null,
          "Sub-interfaces and service restrictions stay active until the helper removes them. Before uninstalling the package, run as root over SSH:"
        ),
        h("pre", { class: "mono" }, `${PACKAGE_COPY} uninstall`),
        h("p", { class: "muted" }, "Then delete the “NetAssign helper” task in Task Scheduler and uninstall NetAssign in Package Center.")
      ),
    ];
    el.replaceChildren(...children.filter(Boolean));
    renderBanner();
  }

  // Never leave the tab blank: a rendering bug shows up as text.
  function safeRender() {
    try {
      render();
    } catch (e) {
      document.getElementById("tab-helper").textContent = "The Helper tab failed to render: " + (e && e.message ? e.message : e);
    }
  }

  window.NA_HELPER = {
    refresh,
    applyBatch,
    blockedReason,
    renderBanner,
    managed: () => (heartbeat() && heartbeat().managed) || [],
    firewall: () => (heartbeat() && heartbeat().firewall) || {},
    pending: () => (heartbeat() && heartbeat().pending) || null,
  };
})();
