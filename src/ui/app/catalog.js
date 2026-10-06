/*
 * Service catalog: which DSM services exist, how to tell whether they are
 * installed/enabled, and which ports they listen on.
 *
 * Port sources, in order of preference:
 *   "api"     — read live from the service's own settings API.
 *   "sc"      — copied from DSM's firewall service definition files
 *               (/usr/local/etc/services.d/*.sc, /usr/syno/etc.defaults/
 *               services.d/*.sc) as shipped on DSM 7.4-90075. Custom port
 *               changes made through the owning package are not reflected;
 *               the values below are DSM defaults for those packages.
 *   "default" — DSM's documented default port; used only for services
 *               that have neither an API nor a .sc definition.
 *
 * Each resolver receives `d`, a lookup of API results keyed like
 * "SYNO.Core.Web.DSM.get.v2", and returns null when the service does
 * not apply to this DiskStation at all.
 */
(function () {
  "use strict";

  function data(d, key) {
    const r = d[key];
    return r && r.success ? r.data : null;
  }

  function pkgStatus(d, id) {
    const list = (data(d, "SYNO.Core.Package.list.v2") || {}).packages || [];
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    return (p.additional && p.additional.status) || "unknown";
  }

  function port(proto, ports, label, source) {
    return { proto, ports: String(ports), label: label || "", source };
  }

  // Services whose enable flag and ports come from a settings API.
  const API_SERVICES = [
    {
      id: "dsm",
      name: "DSM web UI and Web API",
      group: "System",
      resolve(d) {
        const w = data(d, "SYNO.Core.Web.DSM.get.v2");
        return {
          enabled: true,
          ports: [
            port("tcp", w ? w.http_port : 5000, "HTTP", w ? "api" : "default"),
            port("tcp", w ? w.https_port : 5001, "HTTPS", w ? "api" : "default"),
          ],
          note:
            "Also serves every Login Portal alias (e.g. /audio, /chat) and the Web APIs " +
            "that packages and the Synology mobile apps use.",
        };
      },
    },
    {
      id: "web",
      name: "Web Station / Login Portal (80, 443)",
      group: "System",
      resolve() {
        return {
          enabled: true,
          ports: [port("tcp", 80, "HTTP", "sc"), port("tcp", 443, "HTTPS", "sc")],
          note: "DSM's nginx answers here too and serves Login Portal aliases.",
        };
      },
    },
    {
      id: "ssh",
      name: "SSH",
      group: "System",
      resolve(d) {
        const t = data(d, "SYNO.Core.Terminal.get.v3");
        if (!t) return { enabled: null, ports: [port("tcp", 22, "", "default")] };
        return { enabled: !!t.enable_ssh, ports: [port("tcp", t.ssh_port || 22, "", "api")] };
      },
    },
    {
      id: "snmp",
      name: "SNMP",
      group: "System",
      resolve(d) {
        const s = data(d, "SYNO.Core.SNMP.get.v1");
        return { enabled: s ? !!s.enable_snmp : null, ports: [port("udp", 161, "", "default")] };
      },
    },
    {
      id: "rsync",
      name: "rsync (network backup server)",
      group: "Backup",
      resolve() {
        return { enabled: null, ports: [port("tcp", 873, "", "sc")] };
      },
    },
    {
      id: "smb",
      name: "SMB/CIFS",
      group: "File services",
      resolve(d) {
        const s = data(d, "SYNO.Core.FileServ.SMB.get.v3");
        if (!pkgStatus(d, "SMBService") && !s) return null;
        return {
          enabled: s ? !!s.enable_samba : null,
          ports: [port("tcp", "137,138,139,445", "", "sc"), port("udp", "137,138,139,445", "", "sc")],
        };
      },
    },
    {
      id: "wsd",
      name: "WS-Discovery (Windows network browsing)",
      group: "File services",
      resolve(d) {
        if (!pkgStatus(d, "SMBService")) return null;
        return {
          enabled: null,
          ports: [port("tcp", 5357, "WS-Transfer", "sc"), port("udp", 3702, "WS-Discovery", "sc")],
        };
      },
    },
    {
      id: "afp",
      name: "AFP",
      group: "File services",
      resolve(d) {
        const a = data(d, "SYNO.Core.FileServ.AFP.get.v2");
        return { enabled: a ? !!a.enable_afp : null, ports: [port("tcp", 548, "", "default")] };
      },
    },
    {
      id: "nfs",
      name: "NFS",
      group: "File services",
      resolve(d) {
        const n = data(d, "SYNO.Core.FileServ.NFS.get.v3");
        return {
          enabled: n ? !!n.enable_nfs : null,
          ports: [port("tcp", "111,892,2049", "", "default"), port("udp", "111,892,2049", "", "default")],
        };
      },
    },
    {
      id: "ftp",
      name: "FTP / FTPS",
      group: "File services",
      resolve(d) {
        const f = data(d, "SYNO.Core.FileServ.FTP.get.v3");
        const ports = [port("tcp", 21, "Control", "default")];
        if (f && f.custom_port) ports.push(port("tcp", f.custom_port.replace(":", "-"), "Passive", "api"));
        return { enabled: f ? !!(f.enable_ftp || f.enable_ftps) : null, ports };
      },
    },
    {
      id: "sftp",
      name: "SFTP",
      group: "File services",
      resolve(d) {
        const s = data(d, "SYNO.Core.FileServ.FTP.SFTP.get.v1");
        return { enabled: s ? !!s.enable : null, ports: [port("tcp", s ? s.portnum : 22, "", s ? "api" : "default")] };
      },
    },
    {
      id: "webdav",
      name: "WebDAV",
      group: "File services",
      resolve(d) {
        const w = data(d, "SYNO.WebDAV.Common.get.v1");
        if (!pkgStatus(d, "WebDAVServer")) return null;
        if (!w) return { enabled: null, ports: [port("tcp", 5005, "HTTP", "default"), port("tcp", 5006, "HTTPS", "default")] };
        const ports = [];
        if (w.enable_http) ports.push(port("tcp", w.http_port, "HTTP", "api"));
        if (w.enable_https) ports.push(port("tcp", w.https_port, "HTTPS", "api"));
        return {
          enabled: !!(w.enable_http || w.enable_https),
          ports,
          note: !w.enable_https ? `HTTPS (port ${w.https_port}) is disabled.` : "",
        };
      },
    },
    {
      id: "iscsi",
      name: "iSCSI target",
      group: "Storage",
      resolve(d) {
        if (!pkgStatus(d, "ScsiTarget")) return null;
        const t = (data(d, "SYNO.Core.ISCSI.Target.list.v1") || {}).targets;
        return {
          enabled: t ? t.some((x) => x.is_enabled) : null,
          ports: [port("tcp", "3260,3261,3262", "", "sc")],
          note: "LUN replication 3261, Windows ODX 3263, VMM remote storage 3264 and Storage Console 3265 are separate firewall services.",
        };
      },
    },
  ];

  // Package services with fixed ports from DSM's .sc definitions.
  const PACKAGE_SERVICES = [
    { id: "drive", pkg: "SynologyDrive", name: "Synology Drive (client sync)", group: "File services", ports: [["tcp", "6690"]] },
    { id: "hbvault", pkg: "HyperBackupVault", name: "Hyper Backup Vault", group: "Backup", ports: [["tcp", "6281"]] },
    { id: "replication", pkg: "ReplicationService", name: "Snapshot Replication", group: "Backup", ports: [["tcp", "5566"]] },
    { id: "mediaserver", pkg: "MediaServer", name: "Media Server (DLNA/UPnP)", group: "Media", ports: [["tcp", "50001,50002"], ["udp", "1900"]] },
    { id: "airplay", pkg: "AudioStation", name: "Audio Station AirPlay", group: "Media", ports: [["udp", "6001-6010"], ["tcp", "6011-6030"]] },
    { id: "caldav", pkg: "Calendar", name: "Synology Calendar (CalDAV)", group: "Collaboration", ports: [["tcp", "38008"], ["tcp", "38443"]] },
    { id: "carddav", pkg: "Contacts", name: "Synology Contacts (CardDAV)", group: "Collaboration", ports: [["tcp", "5555"]] },
    { id: "hybridshare", pkg: "HybridShare", name: "Hybrid Share", group: "Storage", ports: [["tcp", "26500-27000"]] },
    { id: "vmm", pkg: "Virtualization", name: "Virtual Machine Manager (cluster)", group: "Virtualization", ports: [["tcp", "2379-2382,2385,16509,16514,30200-30300"]] },
  ];

  function resolveAll(d) {
    const out = [];
    for (const s of API_SERVICES) {
      const r = s.resolve(d);
      if (r) out.push({ id: s.id, name: s.name, group: s.group, note: "", ...r });
    }
    for (const s of PACKAGE_SERVICES) {
      const st = pkgStatus(d, s.pkg);
      if (!st) continue;
      out.push({
        id: s.id,
        name: s.name,
        group: s.group,
        enabled: st === "running",
        ports: s.ports.map(([proto, p]) => port(proto, p, "", "sc")),
        note: st === "running" ? "" : `Package status: ${st}.`,
      });
    }
    // Login Portal applications with their own dedicated ports.
    const portal = (data(d, "SYNO.Core.AppPortal.list.v2") || {}).portal || [];
    for (const a of portal) {
      const ports = [];
      if (a.http_port) ports.push(port("tcp", a.http_port, "HTTP", "api"));
      if (a.https_port) ports.push(port("tcp", a.https_port, "HTTPS", "api"));
      out.push({
        id: "portal:" + a.id,
        name: `${a.display_name} (Login Portal)`,
        group: "Login Portal",
        enabled: true,
        ports,
        note:
          (a.alias ? `Also reachable as /${a.alias} on ports 80, 443 and the DSM ports.` : "") +
          (a.fqdn ? ` Custom domain: ${a.fqdn}.` : ""),
      });
    }
    return out;
  }

  window.NA_CATALOG = { resolveAll };
})();
