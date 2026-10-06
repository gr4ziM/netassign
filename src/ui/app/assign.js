/*
 * NetAssign "Assignment" tab: the single place for all changes.
 *
 * On every app start the draft is the live configuration (DSM's
 * interfaces plus the sub-interfaces the root helper manages). Every
 * row that differs from the live state gets its own Apply button;
 * "Apply all" carries out every applicable change in one helper batch
 * with one snapshot and one confirmation. Changes NetAssign cannot apply
 * yet keep a disabled Apply button that says why.
 *
 * Drafts can be exported/imported as JSON; they are not kept anywhere
 * else.
 */
(function () {
  "use strict";

  const M = window.NA_MODEL;
  const MODES = [
    ["tbd", "Not decided (tbd)"],
    ["networks", "Selected networks"],
    ["any", "All networks"],
    ["blocked", "Blocked everywhere"],
  ];

  const state = {
    services: [],
    ethernets: [],
    currentBase: null,
    draft: null,
    origin: "",
    importInfo: null,
    notice: "",
    noticeAwaitsConfirm: false,
    ovs: null,   // Open vSwitch enabled? (null: unknown)
  };

  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ------------------------------------------------------------ live state

  function managed() {
    return window.NA_HELPER.managed();
  }

  // DSM's own view plus what the helper manages: sub-interfaces (DSM
  // doesn't know them) and per-service firewall policies.
  function current() {
    const cur = clone(state.currentBase);
    for (const m of managed()) {
      const iface = cur.interfaces[m.bridge] || (cur.interfaces[m.bridge] = { networks: [] });
      iface.networks.push({ vlan: m.vlan, tagged: true, address: m.address, gateway: m.gateway || null });
    }
    return M.applyFirewall(cur, window.NA_HELPER.firewall());
  }

  const NEEDS_OVS =
    "VLAN sub-interfaces need Open vSwitch: Control Panel → Network → Network Interface → Manage → Open vSwitch Settings.";

  function changes() {
    const list = M.diffChanges(current(), state.draft, state.services, managed().map((m) => m.key));
    if (state.ovs !== false) return list;
    // Without Open vSwitch the helper can't create sub-interfaces.
    return list.map((c) =>
      c.supported && c.ops.some((o) => o.op.startsWith("subif_")) ? { ...c, supported: false, reason: NEEDS_OVS } : c
    );
  }

  // ------------------------------------------------------------ actions

  function exportDraft() {
    const blob = new Blob([JSON.stringify({ name: "NetAssign draft", plan: state.draft }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "netassign-plan.json";
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  function importDraft(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const plan = parsed.plan || parsed;
        if (!plan || typeof plan !== "object" || !plan.interfaces) throw new Error("no 'interfaces' section");
        const merged = M.mergeServices(plan, state.services);
        state.draft = merged.plan;
        state.origin = `imported ${file.name}`;
        state.importInfo = parsed.notes || parsed.description ? { name: parsed.name, description: parsed.description, notes: parsed.notes || [] } : null;
        state.notice = merged.dropped.length
          ? `Ignored assignments for services not present on this DiskStation: ${merged.dropped.join(", ")}.`
          : "";
      } catch (e) {
        state.notice = `Import failed: ${e.message || e}`;
      }
      render();
    };
    reader.readAsText(file);
  }

  function serviceName(id) {
    return (state.services.find((s) => s.id === id) || { name: id }).name;
  }

  function describeOp(o) {
    if (o.op === "subif_remove") return `• remove ${o.key}`;
    if (o.op === "subif_add") return `• add ${o.bridge}.${o.vlan}: ${o.address}${o.gateway ? " via " + o.gateway : ""} (tag ${o.vlan})`;
    if (o.op === "fw_clear") return `• ${serviceName(o.service)}: remove the restriction (reachable everywhere again)`;
    const where = o.mode === "blocked" ? "blocked on every network" : o.mode === "any" ? "all networks" : `only on ${o.networks.join(", ")}`;
    const from = o.mode === "blocked" ? "" : o.sources.length ? `, only from ${o.sources.join(", ")}` : ", from any source";
    return `• ${serviceName(o.service)}: ${where}${from}`;
  }

  function describeOps(ops) {
    return ops.map(describeOp).join("\n");
  }

  async function applyOps(ops, what) {
    const r = await window.NA_HELPER.applyBatch(ops, what, `Apply ${what} on this DiskStation now?\n\n${describeOps(ops)}`);
    if (!r) return;
    state.notice = r.ok
      ? `${what}: applied. Check that everything still works, then confirm in the banner above (otherwise it reverts automatically).`
      : `${what}: failed — ${r.error}`;
    // An "applied, please confirm" note is cleared once nothing is pending.
    state.noticeAwaitsConfirm = !!r.ok;
    render();
  }

  function renameNetworkKey(oldKey, newKey) {
    if (oldKey === newKey) return;
    for (const a of Object.values(state.draft.services)) {
      a.networks = a.networks.map((k) => (k === oldKey ? newKey : k));
    }
    if (state.draft.defaultRoute === oldKey) state.draft.defaultRoute = newKey;
  }

  function removeNetworkKey(key) {
    for (const a of Object.values(state.draft.services)) a.networks = a.networks.filter((k) => k !== key);
    if (state.draft.defaultRoute === key) state.draft.defaultRoute = null;
  }

  // ------------------------------------------------------------ rendering

  function ctx() {
    const hostParam = new URLSearchParams(location.search).get("host");
    return {
      physical: state.ethernets.map((e) => e.ifname),
      services: state.services,
      adminHost: hostParam || location.hostname,
    };
  }

  // Apply button for one row; nothing when the row is unchanged.
  function applyCell(ui, change) {
    const { h } = ui;
    if (!change) return h("span");
    const blocked = change.supported ? window.NA_HELPER.blockedReason("apply_batch") : change.reason;
    return h(
      "div",
      { class: "apply-cell" },
      h(
        "button",
        {
          type: "button",
          class: "primary",
          disabled: !!blocked || null,
          title: blocked || "Apply this row now",
          onclick: () => applyOps(change.ops, change.area === "service" ? change.label : change.target),
        },
        "Apply"
      ),
      blocked ? h("div", { class: "muted small" }, blocked) : null
    );
  }

  function renderToolbar(ui, list) {
    const { h } = ui;
    const fileInput = h("input", {
      type: "file",
      accept: "application/json,.json",
      hidden: true,
      onchange: (e) => e.target.files[0] && importDraft(e.target.files[0]),
    });
    const ops = M.batchOps(list);
    const pendingCount = list.filter((c) => !c.supported).length;
    let applyAll = null;
    if (list.length) {
      const blocked = !ops.length ? "none of the changes can be applied yet" : window.NA_HELPER.blockedReason("apply_batch");
      applyAll = h(
        "div",
        { class: "apply-all" },
        h(
          "button",
          {
            type: "button",
            class: "primary",
            disabled: !!blocked || null,
            title: blocked || "Apply every applicable change as one unit",
            onclick: () => applyOps(ops, `${list.filter((c) => c.supported).length} change(s)`),
          },
          `Apply all (${list.filter((c) => c.supported).length})`
        ),
        blocked
          ? h("div", { class: "muted small" }, blocked)
          : pendingCount
            ? h("div", { class: "muted small" }, `${pendingCount} other change(s) can't be applied yet and stay in the draft.`)
            : null
      );
    }
    return h(
      "div",
      { class: "toolbar toolbar-split" },
      h(
        "div",
        { class: "toolbar" },
        h("button", { type: "button", onclick: () => fileInput.click() }, "Import JSON"),
        h("button", { type: "button", onclick: exportDraft }, "Export JSON"),
        fileInput,
        h("span", { class: "muted" }, `Draft based on ${state.origin}.`)
      ),
      applyAll
    );
  }

  function renderImportInfo(ui) {
    const { h } = ui;
    const p = state.importInfo;
    if (!p) return null;
    return h(
      "details",
      { class: "card" },
      h("summary", null, h("strong", null, p.name || "Imported plan")),
      p.description ? h("p", null, p.description) : null,
      (p.notes || []).length ? h("ul", null, p.notes.map((n) => h("li", null, n))) : null
    );
  }

  function renderValidation(ui, result) {
    const { h, badge } = ui;
    const items = [
      ...result.errors.map((t) => ["bad", "error", t]),
      ...result.warnings.map((t) => ["warn", "check", t]),
    ];
    if (!items.length) return h("ul", { class: "findings" }, h("li", null, badge("ok", "ok"), h("span", null, "No problems found.")));
    return h(
      "ul",
      { class: "findings" },
      items.map(([kind, label, text]) => h("li", null, badge(label, kind), h("span", null, text)))
    );
  }

  function networkRow(ui, ifname, cfg, n, idx, change) {
    const { h } = ui;
    const key = M.networkKey(ifname, n);
    const update = (mutate) => {
      const before = M.networkKey(ifname, n);
      mutate();
      renameNetworkKey(before, M.networkKey(ifname, n));
      render();
    };
    const input = (attrs) => h("input", attrs);
    return h(
      "tr",
      { class: change ? "changed" : null },
      h("td", null, h("span", { class: "mono" }, key)),
      h(
        "td",
        null,
        input({
          type: "number", min: 1, max: 4094, class: "num",
          value: n.vlan === null || n.vlan === undefined ? "" : n.vlan,
          "aria-label": `VLAN ID for ${key}`,
          onchange: (ev) => update(() => (n.vlan = ev.target.value === "" ? null : Number(ev.target.value))),
        })
      ),
      h(
        "td",
        null,
        input({
          type: "checkbox", checked: !!n.tagged, "aria-label": `Tagged ${key}`,
          onchange: (ev) => update(() => (n.tagged = ev.target.checked)),
        })
      ),
      h(
        "td",
        null,
        input({
          type: "text", value: n.address || "", placeholder: "10.0.0.2/24", class: "mono",
          "aria-label": `Address for ${key}`,
          onchange: (ev) => update(() => (n.address = ev.target.value.trim())),
        })
      ),
      h(
        "td",
        null,
        input({
          type: "text", value: n.gateway || "", placeholder: "optional", class: "mono",
          "aria-label": `Gateway for ${key}`,
          onchange: (ev) => update(() => (n.gateway = ev.target.value.trim() || null)),
        })
      ),
      h(
        "td",
        null,
        h(
          "button",
          {
            type: "button",
            onclick: () => {
              removeNetworkKey(key);
              cfg.networks.splice(idx, 1);
              render();
            },
          },
          "Remove"
        )
      ),
      h("td", null, applyCell(ui, change))
    );
  }

  // A live network that the draft drops: shown struck through until the
  // removal is applied, with "Keep" to take it back into the draft.
  function removedRow(ui, ifname, cfg, change) {
    const { h } = ui;
    const n = change.net;
    return h(
      "tr",
      { class: "removed" },
      h("td", null, h("span", { class: "mono" }, change.target)),
      h("td", null, n.vlan === null || n.vlan === undefined ? "" : String(n.vlan)),
      h("td", null, n.tagged ? "✓" : ""),
      h("td", null, h("span", { class: "mono" }, n.address)),
      h("td", null, h("span", { class: "mono" }, n.gateway || "")),
      h(
        "td",
        null,
        h(
          "button",
          {
            type: "button",
            onclick: () => {
              cfg.networks.push({ vlan: n.vlan, tagged: n.tagged, address: n.address, gateway: n.gateway || null });
              render();
            },
          },
          "Keep"
        )
      ),
      h("td", null, applyCell(ui, change))
    );
  }

  function renderNetworks(ui, byId) {
    const { h } = ui;
    const cards = state.ethernets.map((e) => {
      const cfg = state.draft.interfaces[e.ifname] || (state.draft.interfaces[e.ifname] = { networks: [] });
      const rows = cfg.networks.map((n, idx) => networkRow(ui, e.ifname, cfg, n, idx, byId.get("net:" + M.networkKey(e.ifname, n))));
      const removed = [...byId.values()].filter(
        (c) => c.area === "network" && c.kind === "remove" && c.target.split(".")[0] === e.ifname
      );
      return h(
        "div",
        { class: "card" },
        h("h3", null, h("span", { class: "mono" }, e.ifname), h("span", { class: "muted" }, ` · ${e.status}`)),
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            null,
            h("thead", null, h("tr", null, ["Network", "VLAN", "Tagged", "Address/prefix", "Gateway", "", ""].map((x) => h("th", null, x)))),
            h("tbody", null, rows, removed.map((c) => removedRow(ui, e.ifname, cfg, c)))
          )
        ),
        h(
          "div",
          { class: "toolbar", style: "margin-top:8px" },
          h(
            "button",
            {
              type: "button",
              onclick: () => {
                cfg.networks.push({ vlan: null, tagged: cfg.networks.some((x) => !x.tagged), address: "", gateway: null });
                render();
              },
            },
            "Add network"
          )
        )
      );
    });

    const nets = M.listNetworks(state.draft);
    const routeSelect = h(
      "select",
      {
        "aria-label": "Default route",
        onchange: (ev) => {
          state.draft.defaultRoute = ev.target.value || null;
          render();
        },
      },
      h("option", { value: "", selected: !state.draft.defaultRoute }, "— not decided —"),
      nets
        .filter((n) => n.gateway)
        .map((n) => h("option", { value: n.key, selected: state.draft.defaultRoute === n.key }, `${n.key} (gateway ${n.gateway})`))
    );
    const routeChange = byId.get("route");

    return [
      h("h2", null, "Networks"),
      h(
        "p",
        { class: "muted" },
        "One untagged network per port; add tagged networks for further VLANs on the same port. Changed rows are highlighted and get an Apply button."
      ),
      h("div", { style: "display:grid;gap:12px" }, cards),
      h(
        "div",
        { class: "toolbar" + (routeChange ? " changed-inline" : ""), style: "margin-top:10px" },
        h("label", null, "Default route: ", routeSelect),
        applyCell(ui, routeChange)
      ),
    ];
  }

  function renderServices(ui, byId) {
    const { h, badge } = ui;
    const nets = M.listNetworks(state.draft);
    // Disabled services can't be reached anyway; they stay in the draft.
    const visible = state.services.filter((s) => s.enabled !== false);
    const rows = visible.map((s) => {
      const a = state.draft.services[s.id];
      const change = byId.get("svc:" + s.id);
      const modeSelect = h(
        "select",
        {
          "aria-label": `Assignment for ${s.name}`,
          onchange: (ev) => {
            a.mode = ev.target.value;
            render();
          },
        },
        MODES.map(([v, label]) => h("option", { value: v, selected: a.mode === v }, label))
      );
      const netBoxes =
        a.mode === "networks"
          ? h(
              "div",
              { class: "checks" },
              nets.map((n) =>
                h(
                  "label",
                  { class: "mono" },
                  h("input", {
                    type: "checkbox",
                    checked: a.networks.includes(n.key),
                    onchange: (ev) => {
                      a.networks = ev.target.checked ? [...a.networks, n.key] : a.networks.filter((k) => k !== n.key);
                      render();
                    },
                  }),
                  " ",
                  n.key
                )
              )
            )
          : null;

      let sourcesCell = h("span", { class: "muted" }, "–");
      if (a.mode === "networks" || a.mode === "any") {
        const kind = a.sources === null ? "tbd" : a.sources.length ? "list" : "any";
        const kindSelect = h(
          "select",
          {
            "aria-label": `Sources for ${s.name}`,
            onchange: (ev) => {
              a.sources = ev.target.value === "tbd" ? null : ev.target.value === "any" ? [] : a.sources && a.sources.length ? a.sources : [""];
              render();
            },
          },
          h("option", { value: "tbd", selected: kind === "tbd" }, "Not decided (tbd)"),
          h("option", { value: "any", selected: kind === "any" }, "Any source"),
          h("option", { value: "list", selected: kind === "list" }, "Only these:")
        );
        sourcesCell = h(
          "div",
          null,
          kindSelect,
          kind === "list"
            ? h(
                "textarea",
                {
                  class: "mono",
                  rows: Math.min(4, Math.max(1, a.sources.length)),
                  placeholder: "192.168.100.0/24, one per line",
                  "aria-label": `Source list for ${s.name}`,
                  onchange: (ev) => {
                    const list = ev.target.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
                    a.sources = list.length ? list : [""];
                    render();
                  },
                },
                a.sources.filter(Boolean).join("\n")
              )
            : null
        );
      }

      return h(
        "tr",
        { class: change ? "changed" : null },
        h("td", null, h("strong", null, s.name), h("div", { class: "muted" }, s.group)),
        h("td", null, h("span", { class: "mono" }, s.ports.map((p) => `${p.ports}/${p.proto}`).join(", ") || "–")),
        h("td", null, s.enabled === null ? badge("unknown") : badge("enabled", "ok")),
        h("td", null, modeSelect, netBoxes),
        h("td", null, sourcesCell),
        h("td", null, applyCell(ui, change))
      );
    });
    const hidden = state.services.length - visible.length;
    return [
      h("h2", null, "Services"),
      h(
        "p",
        { class: "muted" },
        "Assigned services will be allowed only on their networks and only from their sources." +
          (hidden ? ` ${hidden} disabled service(s) are hidden.` : "")
      ),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, ["Service", "Ports", "State", "Assignment", "Allowed sources", ""].map((x) => h("th", null, x)))),
          h("tbody", null, rows)
        )
      ),
    ];
  }

  function render() {
    const ui = window.NA_UI;
    if (!state.draft || !ui) return;
    const { h } = ui;
    if (state.noticeAwaitsConfirm && !window.NA_HELPER.pending()) {
      state.notice = "";
      state.noticeAwaitsConfirm = false;
    }
    const result = M.validate(state.draft, ctx());
    const list = changes();
    const byId = new Map(list.map((c) => [c.id, c]));
    const scrollY = window.scrollY;
    const children = [
      // Filled by helper.js while a change waits for confirmation.
      h("div", { id: "pending", class: "pending", role: "alert", hidden: true }),
      renderToolbar(ui, list),
      state.notice ? h("p", { class: "notice" }, state.notice) : null,
      renderImportInfo(ui),
      h("h2", null, `Validation (${result.errors.length} error(s), ${result.warnings.length} warning(s))`),
      renderValidation(ui, result),
      ...renderNetworks(ui, byId),
      ...renderServices(ui, byId),
    ];
    // replaceChildren() would render null as the text "null".
    document.getElementById("tab-assignment").replaceChildren(...children.filter(Boolean));
    window.NA_HELPER.renderBanner();
    window.scrollTo(0, scrollY);
  }

  // Called by app.js after every refresh, once the helper state is known.
  function update(d, services) {
    state.services = services;
    state.ethernets = (d["SYNO.Core.Network.Ethernet.list.v2"] || {}).data || [];
    state.ovs = (((d["SYNO.Core.Network.OVS.get.v1"] || {}).data) || {}).enable_ovs;
    state.currentBase = M.fromCurrent(state.ethernets, services);
    if (!state.draft) {
      state.draft = clone(current());
      state.origin = "the current configuration";
    }
    render();
  }

  // Called by helper.js when the helper state changes.
  function rerender() {
    if (state.draft) render();
  }

  window.NA_ASSIGN = { update, rerender };
})();
