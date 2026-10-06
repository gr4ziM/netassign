/*
 * NetAssign UI: status overview (Summary, Interfaces, Firewall, Services,
 * Diagnostics) and the shell that loads the Assignment and Helper tabs.
 *
 * Runs in an iframe inside NetAssign's DSM app window, so it shares
 * the administrator's DSM session: requests to /webapi/entry.cgi carry
 * the session cookie automatically and the CSRF token (SynoToken) is
 * read from the parent DSM window. Nothing here writes any setting.
 *
 * Local preview: open index.html?mock=1 with a fixtures file at
 * mock/fixtures.json (captured from a live NAS, never committed).
 */
(function () {
  "use strict";

  const MOCK = new URLSearchParams(location.search).has("mock");

  // ---------------------------------------------------------------- API

  const ERROR_TEXT = {
    102: "API does not exist",
    103: "method does not exist",
    104: "API version not supported",
    105: "permission denied (administrator account required)",
    106: "session timed out",
    107: "session interrupted by duplicate login",
    119: "session token missing or invalid",
  };

  class ApiError extends Error {
    constructor(key, code) {
      super(`${key} failed: ${ERROR_TEXT[code] || "error code " + code}`);
      this.code = code;
    }
  }

  function findSynoToken() {
    // DSM may show the app in an iframe (token lives in window.top) or
    // open it in a new browser tab (token lives in window.opener, the
    // DSM desktop that opened it). Both are same-origin with this page.
    const dsmWindows = [
      ["parent DSM window", () => window.top],
      ["opener DSM window", () => window.opener],
    ];
    const candidates = [];
    for (const [where, win] of dsmWindows) {
      candidates.push([`${where}: _S('SynoToken')`, () => win()._S && win()._S("SynoToken")]);
      candidates.push([`${where}: SYNO.SDS.Session.SynoToken`, () => win().SYNO.SDS.Session.SynoToken]);
    }
    candidates.push(["URL parameter", () => new URLSearchParams(location.search).get("SynoToken")]);
    for (const [source, get] of candidates) {
      try {
        const t = get();
        if (t) return { token: t, source };
      } catch (e) {
        // Cross-origin or not running inside DSM — try the next source.
      }
    }
    return { token: null, source: "none" };
  }

  const auth = MOCK ? { token: null, source: "mock" } : findSynoToken();
  const callLog = [];
  let fixtures = null;

  async function loadFixtures() {
    if (!fixtures) {
      const r = await fetch("mock/fixtures.json", { cache: "no-store" });
      if (!r.ok) throw new Error("mock/fixtures.json not found");
      fixtures = await r.json();
    }
    return fixtures;
  }

  // Returns the full {success, data, error} envelope so optional calls can
  // fail without aborting the whole refresh.
  async function call(api, method, version, params, keySuffix) {
    const key = `${api}.${method}.v${version}` + (keySuffix ? ":" + keySuffix : "");
    const started = performance.now();
    let result;
    try {
      if (MOCK) {
        const fx = await loadFixtures();
        result = fx[key] || { success: false, error: { code: 102 } };
      } else {
        const body = new URLSearchParams({ api, method, version: String(version) });
        for (const [k, v] of Object.entries(params || {})) {
          body.set(k, typeof v === "string" ? v : JSON.stringify(v));
        }
        const headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
        if (auth.token) headers["X-SYNO-TOKEN"] = auth.token;
        const r = await fetch("/webapi/entry.cgi", {
          method: "POST",
          credentials: "same-origin",
          headers,
          body,
        });
        result = await r.json();
      }
    } catch (e) {
      result = { success: false, error: { code: -1, message: String(e) } };
    }
    callLog.push({
      key,
      ok: !!result.success,
      code: result.success ? null : result.error && result.error.code,
      ms: Math.round(performance.now() - started),
    });
    result.key = key;
    return result;
  }

  // ------------------------------------------------------------ Loading

  const CALLS = [
    ["SYNO.Core.System", "info", 1],
    ["SYNO.Core.Network", "get", 2],
    ["SYNO.Core.Network.Ethernet", "list", 2],
    ["SYNO.Core.Network.OVS", "get", 1],
    ["SYNO.Core.Security.Firewall", "get", 1],
    ["SYNO.Core.Security.Firewall.Adapter", "list", 1],
    ["SYNO.Core.Security.Firewall.Profile", "list", 1],
    ["SYNO.Core.Service.Conf", "get", 1],
    ["SYNO.Core.Package", "list", 2, { additional: ["status", "dsm_apps"] }],
    ["SYNO.Core.AppPortal", "list", 2],
    ["SYNO.Core.Web.DSM", "get", 2],
    ["SYNO.Core.Terminal", "get", 3],
    ["SYNO.Core.SNMP", "get", 1],
    ["SYNO.Core.FileServ.SMB", "get", 3],
    ["SYNO.Core.FileServ.AFP", "get", 2],
    ["SYNO.Core.FileServ.NFS", "get", 3],
    ["SYNO.Core.FileServ.FTP", "get", 3],
    ["SYNO.Core.FileServ.FTP.SFTP", "get", 1],
    ["SYNO.WebDAV.Common", "get", 1],
    ["SYNO.Core.ISCSI.Target", "list", 1],
    ["SYNO.Virtualization.Network", "list", 2],
  ];

  // Calls whose failure makes the summary meaningless.
  const REQUIRED = new Set([
    "SYNO.Core.Network.get.v2",
    "SYNO.Core.Network.Ethernet.list.v2",
    "SYNO.Core.Security.Firewall.get.v1",
  ]);

  async function loadAll() {
    callLog.length = 0;
    const results = await Promise.all(CALLS.map(([a, m, v, p]) => call(a, m, v, p)));
    const d = {};
    for (const r of results) d[r.key] = r;

    const profiles = ok(d, "SYNO.Core.Security.Firewall.Profile.list.v1");
    const names = (profiles && profiles.profile_names) || [];
    const got = await Promise.all(
      names.map((n) =>
        call("SYNO.Core.Security.Firewall.Profile", "get", 1, { name: JSON.stringify(n) }, n)
      )
    );
    d.profiles = {};
    names.forEach((n, i) => {
      if (got[i].success) d.profiles[n] = got[i].data;
    });
    return d;
  }

  function ok(d, key) {
    const r = d[key];
    return r && r.success ? r.data : null;
  }

  // ---------------------------------------------------------- Rendering

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function badge(text, kind) {
    return h("span", { class: "badge" + (kind ? " badge-" + kind : "") }, text);
  }

  function kv(pairs) {
    return h(
      "dl",
      { class: "kv" },
      pairs.filter(Boolean).flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])
    );
  }

  function yesNo(v) {
    if (v === null || v === undefined) return badge("unknown");
    return v ? badge("yes", "ok") : badge("no");
  }

  function table(headers, rows) {
    return h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        null,
        h("thead", null, h("tr", null, headers.map((x) => h("th", null, x)))),
        h("tbody", null, rows.map((r) => h("tr", null, r.map((c) => h("td", null, c)))))
      )
    );
  }

  function physicalInterfaces(d) {
    return ok(d, "SYNO.Core.Network.Ethernet.list.v2") || [];
  }

  function fmtPorts(ports) {
    return ports.map((p) => `${p.ports}/${p.proto}` + (p.label ? ` (${p.label})` : "")).join(", ");
  }

  // ---------------------------------------------------------- Findings

  function findings(d, services) {
    const out = [];
    const net = ok(d, "SYNO.Core.Network.get.v2");
    const fw = ok(d, "SYNO.Core.Security.Firewall.get.v1");
    const ifs = physicalInterfaces(d);
    const up = ifs.filter((i) => i.status === "connected");
    const upNames = up.map((i) => i.ifname).join(", ");

    if (fw && !fw.enable_firewall) {
      out.push([
        "bad",
        `The DSM firewall is disabled. Every enabled service is reachable on every connected interface (${upNames}).`,
      ]);
    } else if (fw) {
      out.push(["ok", `The DSM firewall is enabled with profile "${fw.profile_name}".`]);
    }

    const dsm = services.find((s) => s.id === "dsm");
    if (dsm && fw && !fw.enable_firewall && up.length > 1) {
      out.push([
        "warn",
        `The DSM management UI (${fmtPorts(dsm.ports)}) answers on all ${up.length} connected interfaces, not only on the management network.`,
      ]);
    }

    const portal = services.filter((s) => s.group === "Login Portal");
    if (portal.length) {
      out.push([
        "info",
        `${portal.length} Login Portal application(s) are reachable through aliases on ports 80, 443 and the DSM ports in addition to their own ports. Port-based firewall rules cannot separate them from DSM itself.`,
      ]);
    }

    if (net && net.gateway_info) {
      out.push([
        "info",
        `Default route: ${net.gateway} via ${net.gateway_info.ifname} (${net.gateway_info.ip}/${net.gateway_info.mask}).` +
          (net.multi_gateway ? " Multiple gateways are enabled." : ""),
      ]);
    }

    if (net && net.dns_manual) {
      const ifDns = ifs.filter((i) => i.dns && i.dns !== net.dns_primary && i.dns !== net.dns_secondary);
      if (ifDns.length) {
        out.push([
          "info",
          `DNS is set manually to ${[net.dns_primary, net.dns_secondary].filter(Boolean).join(", ")}; ` +
            `per-interface DNS fields differ (${ifDns.map((i) => `${i.ifname}: ${i.dns}`).join(", ")}).`,
        ]);
      }
    }

    const vlanIfs = ifs.filter((i) => i.enable_vlan);
    if (vlanIfs.length) {
      out.push(["info", `VLAN tagging is enabled on ${vlanIfs.map((i) => `${i.ifname} (VLAN ${i.vlan_id})`).join(", ")}.`]);
    }

    const vmm = ok(d, "SYNO.Virtualization.Network.list.v2");
    for (const n of (vmm && vmm.networks) || []) {
      const on = (n.interfaces || []).map((i) => i.ifname).join(", ");
      if (n.num_vinterfaces > 0) {
        out.push([
          "info",
          `Virtual switch "${n.name}" (VLAN ${n.vlan_id || "none"}) connects ${n.num_vinterfaces} VM interface(s) to ${on}.`,
        ]);
      }
    }

    const svcConf = ok(d, "SYNO.Core.Service.Conf.get.v1");
    if (svcConf && svcConf.service_fw_target_interface && svcConf.service_fw_target_interface !== "all") {
      out.push(["info", `Package firewall rules target interface: ${svcConf.service_fw_target_interface}.`]);
    }
    return out;
  }

  // ---------------------------------------------------------- Tabs

  function renderSummary(d, services) {
    const sys = ok(d, "SYNO.Core.System.info.v1") || {};
    const net = ok(d, "SYNO.Core.Network.get.v2") || {};
    const fw = ok(d, "SYNO.Core.Security.Firewall.get.v1") || {};
    const ovs = ok(d, "SYNO.Core.Network.OVS.get.v1");
    const ifs = physicalInterfaces(d);
    const kindText = { bad: "risk", warn: "check", ok: "ok", info: "info" };

    return [
      h("h2", null, "Findings"),
      h(
        "ul",
        { class: "findings" },
        findings(d, services).map(([kind, text]) =>
          h("li", null, badge(kindText[kind], kind === "info" ? "info" : kind), h("span", null, text))
        )
      ),
      h("h2", null, "Overview"),
      h(
        "div",
        { class: "grid" },
        h(
          "div",
          { class: "card" },
          h("h3", null, "System"),
          kv([
            ["Hostname", net.server_name || "–"],
            ["Model", sys.model || "–"],
            ["DSM", sys.firmware_ver || "–"],
            ["Uptime", sys.up_time || "–"],
          ])
        ),
        h(
          "div",
          { class: "card" },
          h("h3", null, "Network"),
          kv([
            ["Default gateway", net.gateway ? `${net.gateway} (${(net.gateway_info || {}).ifname || "?"})` : "–"],
            ["DNS", [net.dns_primary, net.dns_secondary].filter(Boolean).join(", ") || "–"],
            ["DNS mode", net.dns_manual ? "manual" : "automatic"],
            ["Open vSwitch", ovs ? yesNo(ovs.enable_ovs) : badge("unknown")],
            ["Interfaces", `${ifs.filter((i) => i.status === "connected").length} connected / ${ifs.length}`],
          ])
        ),
        h(
          "div",
          { class: "card" },
          h("h3", null, "Firewall"),
          kv([
            ["Enabled", yesNo(fw.enable_firewall)],
            ["Active profile", fw.profile_name || "–"],
            ["Profiles", Object.keys(d.profiles || {}).length],
          ])
        ),
        h(
          "div",
          { class: "card" },
          h("h3", null, "Services"),
          kv([
            ["Detected", services.length],
            ["Enabled", services.filter((s) => s.enabled).length],
            ["Enabled state unknown", services.filter((s) => s.enabled === null).length],
          ])
        )
      ),
    ];
  }

  function renderInterfaces(d) {
    const ifs = physicalInterfaces(d);
    const net = ok(d, "SYNO.Core.Network.get.v2") || {};
    const vmm = ok(d, "SYNO.Virtualization.Network.list.v2");
    const cards = ifs.map((i) => {
      const statusDot = h("span", { class: "dot " + (i.status === "connected" ? "dot-ok" : "dot-off") });
      const switches = ((vmm && vmm.networks) || []).filter((n) =>
        (n.interfaces || []).some((x) => x.ifname === i.ifname)
      );
      return h(
        "div",
        { class: "card" },
        h(
          "h3",
          null,
          statusDot,
          h("span", { class: "mono" }, i.ifname),
          " ",
          i.is_default_gateway ? badge("default route", "info") : null
        ),
        kv([
          ["Status", `${i.status}${i.speed > 0 ? ` · ${i.speed} Mbit/s` : ""}${i.duplex ? " · full duplex" : ""}`],
          ["Address", i.ip ? `${i.ip} / ${i.mask}` : "–"],
          ["Mode", i.use_dhcp ? "DHCP" : "static"],
          ["Gateway", i.gateway || "–"],
          ["DNS (interface)", i.dns || "–"],
          ["VLAN", i.enable_vlan ? `tagged, VLAN ${i.vlan_id}` : "untagged"],
          ["MTU", i.mtu],
          ["IPv6", (i.ipv6 || []).length ? i.ipv6.map((x) => x.address || JSON.stringify(x)).join(", ") : "none"],
          ["Type", i.type],
          switches.length
            ? ["Virtual switches", switches.map((n) => `${n.name} (VLAN ${n.vlan_id || "none"}, ${n.num_vinterfaces} VM NIC)`).join("; ")]
            : null,
        ])
      );
    });

    return [
      h("h2", null, "Physical interfaces"),
      h("div", { class: "grid" }, cards),
      h(
        "p",
        { class: "muted" },
        `Global DNS: ${[net.dns_primary, net.dns_secondary].filter(Boolean).join(", ") || "–"} (${net.dns_manual ? "manual" : "automatic"}). ` +
          "DSM supports at most one VLAN tag per physical interface; NetAssign adds further VLANs as sub-interfaces in the Assignment tab (requires Open vSwitch)."
      ),
    ];
  }

  function ruleRows(rules) {
    return rules.map((r) => [
      r.enable ? badge("on", "ok") : badge("off"),
      r.policy === "allow" ? badge("allow", "ok") : badge(r.policy, "bad"),
      r.protocol,
      h("span", { class: "mono" }, r.port_group === "all" ? "all" : r.ports),
      h("span", { class: "mono" }, r.source_ip_group === "all" ? "any" : `${r.source_ip} (${r.source_ip_group})`),
      r.name || "",
      r.log ? "yes" : "",
    ]);
  }

  function renderFirewall(d) {
    const fw = ok(d, "SYNO.Core.Security.Firewall.get.v1") || {};
    const adapters = (ok(d, "SYNO.Core.Security.Firewall.Adapter.list.v1") || {}).adapter_names || [];
    const policyKind = { allow: "ok", drop: "bad", none: null };
    const profiles = Object.entries(d.profiles || {}).map(([name, p]) => {
      const isActive = name === fw.profile_name;
      const sections = Object.entries(p)
        .filter(([k]) => k !== "name")
        .map(([adapter, cfg]) =>
          h(
            "div",
            { class: "adapter" },
            h(
              "h3",
              null,
              h("span", { class: "mono" }, adapter),
              badge(`default: ${cfg.policy}`, policyKind[cfg.policy]),
              h("span", { class: "muted" }, `${(cfg.rules || []).length} rule(s)`)
            ),
            (cfg.rules || []).length
              ? table(["State", "Action", "Protocol", "Ports", "Source", "Name", "Log"], ruleRows(cfg.rules))
              : null
          )
        );
      return h(
        "details",
        { class: "card" + (isActive ? " active" : ""), open: isActive || null },
        h("summary", null, h("strong", null, name), isActive ? badge("active profile", "info") : null),
        sections.length ? sections : h("p", { class: "muted" }, "No adapter sections defined.")
      );
    });

    return [
      h("h2", null, "Firewall"),
      h(
        "div",
        { class: "card" },
        kv([
          ["Enabled", yesNo(fw.enable_firewall)],
          ["Active profile", fw.profile_name || "–"],
          ["Adapters", h("span", { class: "mono" }, adapters.join(", ") || "–")],
        ])
      ),
      fw.enable_firewall === false
        ? h("p", { class: "muted" }, "The firewall is disabled, so none of the profiles below is currently enforced.")
        : null,
      h("h2", null, "Profiles"),
      h("div", { style: "display:grid;gap:8px" }, profiles),
    ];
  }

  function exposure(d, svc) {
    const fw = ok(d, "SYNO.Core.Security.Firewall.get.v1");
    const up = physicalInterfaces(d).filter((i) => i.status === "connected").map((i) => i.ifname);
    // Unknown enable state (null) is treated as reachable: failing open
    // here would hide exposure rather than overstate it.
    if (svc.enabled === false) return h("span", { class: "muted" }, "–");
    if (fw && !fw.enable_firewall) return h("span", null, badge("all", "warn"), " ", h("span", { class: "mono" }, up.join(", ")));
    return h("span", { class: "muted" }, "see active firewall profile");
  }

  function renderServices(d, services) {
    const state = { showDisabled: false };
    const body = h("div");

    function draw() {
      const rows = services
        .filter((s) => state.showDisabled || s.enabled !== false)
        .map((s) => [
          s.enabled === true ? badge("enabled", "ok") : s.enabled === false ? badge("disabled") : badge("unknown"),
          h("strong", null, s.name),
          s.group,
          h("span", { class: "mono" }, fmtPorts(s.ports) || "–"),
          [...new Set(s.ports.map((p) => p.source))].join(", "),
          exposure(d, s),
          h("span", { class: "muted" }, s.note || ""),
        ]);
      body.replaceChildren(
        table(["State", "Service", "Group", "Ports", "Port source", "Reachable on", "Notes"], rows)
      );
    }

    const toggle = h("input", {
      type: "checkbox",
      id: "show-disabled",
      onchange: (e) => {
        state.showDisabled = e.target.checked;
        draw();
      },
    });
    draw();
    return [
      h("h2", null, "Services"),
      h(
        "div",
        { class: "toolbar" },
        h("label", null, toggle, " Show disabled services"),
        h(
          "span",
          { class: "muted" },
          "Port source: api = live setting, sc = DSM firewall service definition, default = DSM default port."
        )
      ),
      body,
    ];
  }

  function renderDiagnostics() {
    const failed = callLog.filter((c) => !c.ok).length;
    return [
      h("h2", null, "Session"),
      h(
        "div",
        { class: "card" },
        kv([
          ["Mode", MOCK ? "local preview (fixtures)" : "DSM"],
          ["SynoToken source", auth.source],
          ["API calls", `${callLog.length} (${failed} failed)`],
        ])
      ),
      h("h2", null, "API calls"),
      table(
        ["Call", "Result", "Time"],
        callLog.map((c) => [
          h("span", { class: "mono" }, c.key),
          c.ok ? badge("ok", "ok") : badge(`error ${c.code}: ${ERROR_TEXT[c.code] || "see DSM docs"}`, "bad"),
          `${c.ms} ms`,
        ])
      ),
    ];
  }

  // Shared with assign.js.
  window.NA_UI = { h, badge, kv, table, fmtPorts, token: auth.token, mock: MOCK };

  // ---------------------------------------------------------- Main

  function showFatal(text) {
    const el = document.getElementById("fatal");
    el.textContent = text;
    el.hidden = !text;
  }

  function selectTab(name) {
    // A remembered tab may no longer exist (tabs changed between versions).
    if (!document.querySelector(`.tabs button[data-tab="${name}"]`)) name = "summary";
    for (const b of document.querySelectorAll(".tabs button")) {
      b.setAttribute("aria-selected", String(b.dataset.tab === name));
    }
    for (const s of document.querySelectorAll("main .tab")) s.hidden = s.dataset.tab !== name;
    try {
      localStorage.setItem("netassign.tab", name);
    } catch (e) {
      // Storage unavailable — the tab choice is just not remembered.
    }
  }

  async function refresh() {
    const btn = document.getElementById("refresh");
    btn.disabled = true;
    showFatal("");
    try {
      const d = await loadAll();
      const missing = [...REQUIRED].filter((k) => !(d[k] && d[k].success));
      if (missing.length) {
        const codes = missing.map((k) => (d[k] && d[k].error && d[k].error.code) || "?");
        showFatal(
          "Could not read the basic network configuration.\n" +
            missing.map((k, i) => `${k}: ${ERROR_TEXT[codes[i]] || "error " + codes[i]}`).join("\n") +
            (auth.token || MOCK
              ? ""
              : "\n\nNo DSM session token was found. Open NetAssign from the DSM main menu while signed in as an administrator.")
        );
      }
      const services = window.NA_CATALOG.resolveAll(d);
      const sys = ok(d, "SYNO.Core.System.info.v1") || {};
      const net = ok(d, "SYNO.Core.Network.get.v2") || {};
      document.getElementById("host").textContent =
        [net.server_name, sys.model, sys.firmware_ver].filter(Boolean).join(" · ") || "Unknown host";

      document.getElementById("tab-summary").replaceChildren(...renderSummary(d, services));
      document.getElementById("tab-interfaces").replaceChildren(...renderInterfaces(d));
      document.getElementById("tab-firewall").replaceChildren(...renderFirewall(d).filter(Boolean));
      document.getElementById("tab-services").replaceChildren(...renderServices(d, services));
      document.getElementById("tab-diagnostics").replaceChildren(...renderDiagnostics());
      // The helper's managed sub-interfaces are part of the live state the
      // Assignment draft starts from, so load them first.
      await window.NA_HELPER.refresh().catch((e) => showFatal("Helper tab: " + (e && e.message ? e.message : e)));
      window.NA_ASSIGN.update(d, services);
    } catch (e) {
      showFatal("Unexpected error: " + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
    }
  }

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) selectTab(b.dataset.tab);
  });
  document.getElementById("refresh").addEventListener("click", refresh);
  // helper.js triggers a full refresh after every applied change.
  window.NA_APP = { refresh };

  let initial = "summary";
  try {
    initial = localStorage.getItem("netassign.tab") || "summary";
  } catch (e) {
    // Storage unavailable — start on the summary tab.
  }
  selectTab(initial);
  refresh();
})();
