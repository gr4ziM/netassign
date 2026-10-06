/*
 * NetAssign desired-state model: IPv4 helpers, validation, and the
 * row-by-row diff between live state and draft that drives the
 * Assignment tab's Apply buttons. Pure functions only (no DOM, no DSM calls) so they can be
 * exercised by tests/model.test.html.
 *
 * Desired state ("assignment"):
 * {
 *   version: 1,
 *   interfaces: {
 *     "<ifname>": { networks: [ { vlan, tagged, address: "a.b.c.d/nn", gateway } ] }
 *   },
 *   defaultRoute: "<network key>" | null,
 *   services: {
 *     "<service id>": { mode: "tbd" | "blocked" | "any" | "networks",
 *                       networks: ["<network key>", ...],
 *                       sources: null | ["a.b.c.d/nn", ...] }
 *   }
 * }
 *
 * Network key: "<ifname>" for the untagged network of an interface,
 * "<ifname>.<vlan>" for a tagged one — the Linux VLAN naming convention.
 * sources: [] = any source, null = not decided yet ("tbd"; blocks apply).
 */
(function () {
  "use strict";

  // ------------------------------------------------------------ IPv4

  function parseIp(s) {
    if (typeof s !== "string") return null;
    const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    if (parts.some((p) => p > 255)) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  }

  function fmtIp(n) {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }

  function prefixMask(prefix) {
    return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  }

  function maskToPrefix(mask) {
    const n = parseIp(mask);
    if (n === null) return null;
    let prefix = 0;
    while (prefix < 32 && (n & (0x80000000 >>> prefix)) !== 0) prefix++;
    return prefixMask(prefix) === n ? prefix : null;
  }

  // "a.b.c.d/nn" (or a bare IP = /32) -> {ip, prefix, net, bcast} | null
  function parseCidr(s) {
    if (typeof s !== "string") return null;
    const [ipPart, prefixPart, extra] = s.trim().split("/");
    if (extra !== undefined) return null;
    const ip = parseIp(ipPart);
    const prefix = prefixPart === undefined ? 32 : /^\d{1,2}$/.test(prefixPart) ? Number(prefixPart) : NaN;
    if (ip === null || !(prefix >= 0 && prefix <= 32)) return null;
    const mask = prefixMask(prefix);
    const net = (ip & mask) >>> 0;
    return { ip, prefix, net, bcast: (net | (~mask >>> 0)) >>> 0 };
  }

  function contains(cidr, ip) {
    return ((ip & prefixMask(cidr.prefix)) >>> 0) === cidr.net;
  }

  function overlaps(a, b) {
    return a.net <= b.bcast && b.net <= a.bcast;
  }

  // ------------------------------------------------------------ Model

  function networkKey(ifname, net) {
    return net.tagged ? `${ifname}.${net.vlan}` : ifname;
  }

  function listNetworks(plan) {
    const out = [];
    for (const [ifname, cfg] of Object.entries(plan.interfaces || {})) {
      for (const net of cfg.networks || []) out.push({ key: networkKey(ifname, net), ifname, ...net });
    }
    return out;
  }

  // Build a desired state that mirrors the live configuration: every
  // configured interface address becomes a network and, because that is
  // what is true while the firewall is off, every service is "any".
  function fromCurrent(ethernets, services) {
    const plan = { version: 1, interfaces: {}, defaultRoute: null, services: {} };
    for (const e of ethernets) {
      const networks = [];
      if (e.ip) {
        const prefix = maskToPrefix(e.mask);
        networks.push({
          vlan: e.enable_vlan ? e.vlan_id : null,
          tagged: !!e.enable_vlan,
          address: `${e.ip}/${prefix === null ? 32 : prefix}`,
          gateway: e.gateway || null,
        });
      }
      plan.interfaces[e.ifname] = { networks };
      if (e.is_default_gateway && networks.length) plan.defaultRoute = networkKey(e.ifname, networks[0]);
    }
    for (const s of services) plan.services[s.id] = { mode: "any", networks: [], sources: [] };
    return plan;
  }

  // Services the preset doesn't mention are added as "tbd"; services the
  // preset mentions that aren't installed are dropped (with a note).
  function mergeServices(plan, services) {
    const known = new Set(services.map((s) => s.id));
    const dropped = Object.keys(plan.services || {}).filter((id) => !known.has(id));
    const merged = {};
    for (const s of services) {
      merged[s.id] = (plan.services || {})[s.id] || { mode: "tbd", networks: [], sources: null };
    }
    return { plan: { ...plan, services: merged }, dropped };
  }

  // ------------------------------------------------------------ Validation

  // ctx: { physical: [ifname], services: [catalog entries], adminHost }
  function validate(plan, ctx) {
    const errors = [];
    const warnings = [];
    const nets = listNetworks(plan);
    const byKey = new Map(nets.map((n) => [n.key, n]));
    const svcName = (id) => (ctx.services.find((s) => s.id === id) || { name: id }).name;

    for (const ifname of Object.keys(plan.interfaces || {})) {
      if (!ctx.physical.includes(ifname)) errors.push(`Interface ${ifname} does not exist on this DiskStation.`);
    }

    const parsed = new Map();
    const seenKeys = new Set();
    for (const [ifname, cfg] of Object.entries(plan.interfaces || {})) {
      const list = cfg.networks || [];
      if (!list.length) warnings.push(`${ifname} has no network; it will carry no address.`);
      if (list.filter((n) => !n.tagged).length > 1) {
        errors.push(`${ifname} has more than one untagged network; a port can carry only one.`);
      }
      for (const n of list) {
        const key = networkKey(ifname, n);
        if (seenKeys.has(key)) errors.push(`${key} is defined twice.`);
        seenKeys.add(key);
        if (n.tagged && !(Number.isInteger(n.vlan) && n.vlan >= 1 && n.vlan <= 4094)) {
          errors.push(`${key}: a tagged network needs a VLAN ID between 1 and 4094.`);
        }
        if (n.tagged && key.length > 15) errors.push(`${key}: interface name longer than 15 characters.`);
        const c = parseCidr(n.address || "");
        if (!c || !String(n.address).includes("/")) {
          errors.push(`${key}: "${n.address || ""}" is not an address with prefix (e.g. 10.0.0.2/24).`);
          continue;
        }
        if (c.prefix < 31 && (c.ip === c.net || c.ip === c.bcast)) {
          errors.push(`${key}: ${n.address} is the network or broadcast address of its subnet.`);
        }
        parsed.set(key, c);
        if (n.gateway) {
          const g = parseIp(n.gateway);
          if (g === null) errors.push(`${key}: gateway "${n.gateway}" is not an IPv4 address.`);
          else if (!contains(c, g)) errors.push(`${key}: gateway ${n.gateway} is outside ${n.address}.`);
          else if (g === c.ip) errors.push(`${key}: gateway equals the interface address.`);
        }
      }
    }

    const entries = [...parsed.entries()];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [ka, a] = entries[i];
        const [kb, b] = entries[j];
        if (overlaps(a, b)) errors.push(`${ka} and ${kb} have overlapping subnets.`);
      }
    }

    if (!plan.defaultRoute) {
      errors.push("No default route selected.");
    } else if (!byKey.has(plan.defaultRoute)) {
      errors.push(`Default route uses ${plan.defaultRoute}, which is not defined.`);
    } else if (!byKey.get(plan.defaultRoute).gateway) {
      errors.push(`Default route uses ${plan.defaultRoute}, which has no gateway.`);
    }

    for (const [id, a] of Object.entries(plan.services || {})) {
      const name = svcName(id);
      if (a.mode === "networks") {
        if (!a.networks.length) errors.push(`${name}: no network selected.`);
        for (const k of a.networks) if (!byKey.has(k)) errors.push(`${name}: network ${k} is not defined.`);
      }
      if (a.mode === "networks" || a.mode === "any") {
        if (a.sources === null) warnings.push(`${name}: allowed sources are not decided yet (tbd).`);
        for (const src of a.sources || []) {
          if (!parseCidr(src)) errors.push(`${name}: source "${src}" is not an IPv4 address or subnet.`);
        }
      }
    }

    const tbd = Object.entries(plan.services || {}).filter(([, a]) => a.mode === "tbd");
    if (tbd.length) warnings.push(`${tbd.length} service(s) are not assigned yet (tbd).`);

    // Lockout protection: the DSM UI must stay reachable from here.
    const dsm = (plan.services || {}).dsm;
    if (dsm && (dsm.mode === "blocked" || dsm.mode === "tbd")) {
      errors.push("The DSM web UI must be reachable on at least one network, or you lock yourself out.");
    } else if (dsm && dsm.mode === "networks") {
      const host = parseIp(ctx.adminHost || "");
      if (host === null) {
        warnings.push(
          `You reach DSM as "${ctx.adminHost}", not by IP address; check yourself that it resolves to an address DSM stays assigned to.`
        );
      } else {
        const reach = dsm.networks.some((k) => parsed.has(k) && parsed.get(k).ip === host);
        if (!reach) {
          errors.push(
            `You are connected to DSM via ${ctx.adminHost}, which is not an address of a network DSM stays assigned to. ` +
              "Applying this would cut your current session."
          );
        }
      }
    }

    const dsmNets = dsm && dsm.mode === "networks" ? new Set(dsm.networks) : null;
    for (const s of ctx.services.filter((x) => x.group === "Login Portal")) {
      const a = (plan.services || {})[s.id];
      if (dsmNets && a && a.mode === "networks" && a.networks.some((k) => !dsmNets.has(k))) {
        warnings.push(
          `${s.name}: its /alias on ports 80/443/5000/5001 follows the DSM web UI's assignment, not this one.`
        );
      }
    }

    if (nets.some((n) => n.tagged) && nets.some((n) => !n.tagged)) {
      const mixed = Object.entries(plan.interfaces || {}).filter(
        ([, c]) => (c.networks || []).some((n) => n.tagged) && (c.networks || []).length > 1
      );
      for (const [ifname] of mixed) {
        warnings.push(
          `${ifname} carries several networks; NetAssign's helper creates its tagged ones as Open vSwitch sub-interfaces.`
        );
      }
    }
    return { errors, warnings };
  }

  // ------------------------------------------------------------ Firewall preview

  function describeNet(n) {
    return `${n.address}${n.gateway ? " via " + n.gateway : ""}${n.tagged ? `, VLAN ${n.vlan} tagged` : n.vlan ? `, VLAN ${n.vlan} untagged` : ""}`;
  }

  // Firewall rules per network key: allow each assigned service's ports
  // from its sources; everything else falls to the default "drop".
  function firewallRules(plan, services) {
    const nets = listNetworks(plan);
    const rules = new Map(nets.map((n) => [n.key, []]));
    for (const s of services) {
      const a = (plan.services || {})[s.id];
      if (!a || !["any", "networks"].includes(a.mode) || !s.ports.length) continue;
      const targets = a.mode === "any" ? nets.map((n) => n.key) : a.networks.filter((k) => rules.has(k));
      // null = not decided: keep it visible as "tbd" rather than
      // silently widening it to "any".
      const sources = a.sources === null ? ["tbd"] : a.sources.length ? a.sources : ["any"];
      for (const k of targets) {
        for (const p of s.ports) {
          for (const src of sources) {
            rules.get(k).push({ service: s.id, serviceName: s.name, proto: p.proto, ports: p.ports, source: src });
          }
        }
      }
    }
    return rules;
  }

  // ------------------------------------------------------------ Changes
  //
  // diffChanges() compares the live configuration with the edited draft
  // row by row. Each change says whether NetAssign can apply it yet and,
  // if so, carries the helper operations for an "apply_batch" request.

  const NOT_YET = {
    untagged: "NetAssign doesn't change a port's own (untagged) address — use Control Panel → Network → Network Interface.",
    foreignVlan: "This VLAN interface was not created by NetAssign.",
    route: "NetAssign doesn't move the default route — set the default gateway in Control Panel → Network.",
    invalid: "Fix the validation errors for this network first.",
    noNetwork: "Select at least one network.",
    sourcesTbd: "Decide the allowed sources first.",
    badSources: "Fix the source list first.",
    noPorts: "This service has no known ports to filter.",
    networkNotLive: "Apply the selected network first: ",
  };

  // "Not decided" and "all networks, any source" both mean: no restriction.
  function unrestricted(a) {
    return a.mode === "tbd" || (a.mode === "any" && Array.isArray(a.sources) && a.sources.length === 0);
  }

  function serviceChange(s, a, liveKeys) {
    const change = { id: "svc:" + s.id, area: "service", target: s.id, kind: "change", label: s.name };
    if (unrestricted(a)) return { ...change, supported: true, ops: [{ op: "fw_clear", service: s.id }] };
    if (!s.ports.length) return { ...change, supported: false, reason: NOT_YET.noPorts };
    if (a.mode === "networks" && !a.networks.length) return { ...change, supported: false, reason: NOT_YET.noNetwork };
    if (a.mode !== "blocked") {
      if (a.sources === null) return { ...change, supported: false, reason: NOT_YET.sourcesTbd };
      if (a.sources.some((x) => !parseCidr(x))) return { ...change, supported: false, reason: NOT_YET.badSources };
    }
    const notLive = a.mode === "networks" ? a.networks.filter((k) => !liveKeys.has(k)) : [];
    if (notLive.length) return { ...change, supported: false, reason: NOT_YET.networkNotLive + notLive.join(", ") };
    return {
      ...change,
      supported: true,
      ops: [
        {
          op: "fw_set",
          service: s.id,
          ports: s.ports.map((p) => ({ proto: p.proto, ports: p.ports })),
          mode: a.mode,
          networks: a.mode === "networks" ? [...a.networks] : [],
          sources: a.mode === "blocked" ? [] : [...a.sources],
        },
      ],
    };
  }

  function netValid(n) {
    const c = parseCidr(n.address || "");
    if (!c || !String(n.address).includes("/") || c.ip === c.net || c.ip === c.bcast) return false;
    if (n.tagged && !(Number.isInteger(n.vlan) && n.vlan >= 2 && n.vlan <= 4094)) return false;
    if (n.gateway) {
      const g = parseIp(n.gateway);
      if (g === null || !contains(c, g) || g === c.ip) return false;
    }
    return true;
  }

  function netDiffers(a, b) {
    return a.address !== b.address || (a.gateway || null) !== (b.gateway || null);
  }

  function normService(a) {
    const scoped = a.mode === "networks" || a.mode === "any";
    return JSON.stringify({
      mode: a.mode,
      networks: a.mode === "networks" ? [...a.networks].sort() : [],
      sources: scoped ? (a.sources === null ? null : [...a.sources].sort()) : null,
    });
  }

  function addOp(n) {
    return { op: "subif_add", bridge: n.ifname, vlan: n.vlan, address: n.address, gateway: n.gateway || null };
  }

  // current: fromCurrent() plus the helper's managed sub-interfaces;
  // managedKeys: keys of the sub-interfaces NetAssign created.
  function diffChanges(current, desired, services, managedKeys) {
    const managed = new Set(managedKeys || []);
    const cur = new Map(listNetworks(current).map((n) => [n.key, n]));
    const des = new Map(listNetworks(desired).map((n) => [n.key, n]));
    const changes = [];

    for (const [key, n] of des) {
      const c = cur.get(key);
      if (c && !netDiffers(c, n)) continue;
      const change = {
        id: "net:" + key,
        area: "network",
        target: key,
        kind: c ? "change" : "add",
        label: (c ? `${describeNet(c)} → ` : "") + describeNet(n),
      };
      if (!n.tagged) Object.assign(change, { supported: false, reason: NOT_YET.untagged });
      else if (c && !managed.has(key)) Object.assign(change, { supported: false, reason: NOT_YET.foreignVlan });
      else if (!netValid(n)) Object.assign(change, { supported: false, reason: NOT_YET.invalid });
      else {
        const ops = c ? [{ op: "subif_remove", key }, addOp(n)] : [addOp(n)];
        Object.assign(change, { supported: true, ops });
      }
      changes.push(change);
    }

    for (const [key, c] of cur) {
      if (des.has(key)) continue;
      const change = { id: "net:" + key, area: "network", target: key, kind: "remove", label: describeNet(c), net: c };
      if (c.tagged && managed.has(key)) Object.assign(change, { supported: true, ops: [{ op: "subif_remove", key }] });
      else Object.assign(change, { supported: false, reason: c.tagged ? NOT_YET.foreignVlan : NOT_YET.untagged });
      changes.push(change);
    }

    if ((desired.defaultRoute || null) !== (current.defaultRoute || null)) {
      changes.push({
        id: "route",
        area: "route",
        target: desired.defaultRoute,
        kind: "change",
        label: `${current.defaultRoute || "none"} → ${desired.defaultRoute || "none"}`,
        supported: false,
        reason: NOT_YET.route,
      });
    }

    const liveKeys = new Set(cur.keys());
    for (const s of services) {
      const a = (desired.services || {})[s.id];
      const b = (current.services || {})[s.id];
      if (!a || !b) continue;
      if (unrestricted(a) ? unrestricted(b) : normService(a) === normService(b)) continue;
      changes.push(serviceChange(s, a, liveKeys));
    }
    return changes;
  }

  // Operations for "Apply all": every supported change; sub-interface
  // removals, then additions, then firewall policies.
  function batchOps(changes) {
    const ops = changes.filter((c) => c.supported).flatMap((c) => c.ops);
    const rank = { subif_remove: 0, subif_add: 1 };
    return ops.map((o, i) => [o, i]).sort((x, y) => ((rank[x[0].op] ?? 2) - (rank[y[0].op] ?? 2)) || x[1] - y[1]).map((x) => x[0]);
  }

  // The live service assignment from the helper's firewall policies
  // (services without a policy are unrestricted).
  function applyFirewall(plan, policies) {
    for (const [id, p] of Object.entries(policies || {})) {
      if (!plan.services[id]) continue;
      plan.services[id] = { mode: p.mode, networks: [...(p.networks || [])], sources: [...(p.sources || [])] };
    }
    return plan;
  }

  window.NA_MODEL = {
    parseIp,
    fmtIp,
    parseCidr,
    maskToPrefix,
    contains,
    overlaps,
    networkKey,
    listNetworks,
    fromCurrent,
    mergeServices,
    validate,
    firewallRules,
    diffChanges,
    batchOps,
    applyFirewall,
  };
})();
