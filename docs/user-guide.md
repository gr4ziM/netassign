# User guide

NetAssign opens as a window in the DSM desktop. Only administrators can
open it. **Refresh** (top right) reloads everything. NetAssign also
reloads on its own after every change.

## Tabs

| Tab | Shows |
|---|---|
| **Summary** | Findings, plus System, Network, Firewall and Services cards (see below) |
| **Interfaces** | Every physical interface: status, speed, address, gateway, per-interface DNS, VLAN tag, MTU, IPv6, attached VMM virtual switches |
| **Firewall** | Whether the DSM firewall is on, the active profile, and every profile with its default policy and rules per adapter |
| **Services** | Every detected service with its ports, where the ports come from, and on which interfaces it is reachable right now. Disabled services can be shown with a checkbox |
| **Assignment** | The only place where you change things (see below) |
| **Helper** | Root helper status and version, the read-only check, managed sub-interfaces, active service restrictions, uninstall instructions |
| **Diagnostics** | Where the session token came from, and every DSM API call with its result |

The **Summary** findings include, for example:
- the DSM firewall is off,
- the DSM UI answers on every interface,
- Login Portal apps are also reachable through aliases,
- the default route,
- DNS differences,
- VLAN tags,
- virtual switches with attached VMs.

### Where service ports come from

| Source | Meaning |
|---|---|
| `api` | Read live from the service's own settings (DSM web ports, SSH, WebDAV, FTP/SFTP, …) |
| `sc` | DSM's firewall service definition for that package, as shipped by Synology. Ports you changed inside a package may not be reflected |
| `default` | DSM's documented default port; used only where neither of the above exists |

## The Assignment tab

Every time NetAssign opens, the draft equals the **live
configuration**. Change whatever you need. Each row that now differs
from the live state turns yellow and gets an **Apply** button.

- **Apply** in a row applies just that row.
- **Apply all** (top right) applies every applicable change together:
  one snapshot, one confirmation, one revert. It appears only when
  something differs.
- If a row can't be applied, its Apply button is disabled and the
  reason is shown underneath.

### Confirm or revert

After applying, a yellow banner appears at the top of the tab with a
5-minute countdown.

1. Check that everything you need still works: DSM, file shares,
   backups, VMs.
2. Click **Confirm — keep it**.

If you click **Revert now**, or do nothing for 5 minutes, the helper
restores the previous state on its own. That happens even if your
browser has lost the connection to the NAS. Only one change can be
pending at a time.

### Networks

Each card is one physical interface: `ovs_ethN` with Open vSwitch,
`ethN` or `bondN` without.

| Field | Meaning |
|---|---|
| Network | The network's key: `ovs_eth0` for the port's own network, `ovs_eth0.131` for VLAN 131 on that port |
| VLAN | The VLAN ID. For the untagged network this is documentation only |
| Tagged | Checked for additional VLANs on the same port. Each port has at most one untagged network |
| Address/prefix | e.g. `192.168.131.21/24` |
| Gateway | Optional. For a tagged network, NetAssign routes replies from that address through this gateway |

What NetAssign applies here:

| Change | Applied? |
|---|---|
| Add a tagged network (VLAN sub-interface) | ✅ requires Open vSwitch |
| Change the address or gateway of a tagged network NetAssign created | ✅ removed and re-added in one step |
| Remove a tagged network NetAssign created | ✅ |
| Change a port's own (untagged) address | ❌ use *Control Panel → Network → Network Interface* |
| Move the default route | ❌ use *Control Panel → Network* |

A network you remove from the draft stays visible, struck through,
until you apply the removal. **Keep** takes it back into the draft.

### Services

Each enabled service has one row. Disabled services are hidden.

**Assignment:**

| Choice | Effect when applied |
|---|---|
| Not decided (tbd) | No restriction |
| Selected networks | Reachable only on the ticked networks; its ports are dropped on every other network |
| All networks | Reachable everywhere. Combined with a source list, it restricts who may connect |
| Blocked everywhere | Its ports are dropped on every network |

**Allowed sources** (for *Selected networks* and *All networks*):

| Choice | Effect |
|---|---|
| Any source | Anyone who can reach the network |
| Only these: | One address or subnet per line, e.g. `192.168.1.0/24` or `192.168.1.7` |
| Not decided (tbd) | The row can't be applied until you decide |

A service row can be applied when:

- *Selected networks* has at least one network ticked,
- the sources are decided and valid,
- the selected networks already exist live. Apply a new VLAN first,
  then the services that use it.

**Not filtered:**

- connections from the DiskStation to itself,
- Docker containers on Docker's own bridge,
- replies to connections the DiskStation opened.

Outgoing backups and syncs therefore keep working, even if the same
service is restricted for incoming connections.

VMs attached to an Open vSwitch virtual switch *are* filtered. They
reach the NAS through that port's network, just like any other client.

### Validation

Above the networks, NetAssign lists errors and checks for the draft:

- invalid addresses, gateways outside the subnet, overlapping subnets,
  two untagged networks on one port,
- **lock-out risks**: the DSM UI blocked, undecided, or moved away
  from the address you are connected through.

Separately, the helper refuses any firewall change that would drop the
connection you are applying it from.

## Common tasks

### Add a VLAN to a port

Example: storage VLAN 131 on the port of `ovs_eth0`.

1. Configure the switch port to carry VLAN 131 **tagged**.
2. *Assignment → ovs_eth0 card → Add network*.
3. VLAN `131`, **Tagged** ✓, address `192.168.131.21/24`, gateway
   `192.168.131.1` (optional).
4. Click **Apply** in the row and confirm the dialog.
5. Check:
   - ping `192.168.131.21` from a client,
   - the *Helper* tab shows the sub-interface.
6. **Confirm — keep it**.

### Restrict a service to one network

Example: SMB only on the storage VLAN.

1. In the *SMB/CIFS* row choose **Selected networks** and tick only
   `ovs_eth0.131`.
2. Allowed sources: **Any source**, or **Only these:** with your client
   subnets.
3. Click **Apply** → test a share from a client → **Confirm**.

> Clients that mounted the share through another address of the NAS
> lose access. Re-point them to the address on the allowed network
> first.

### Allow the DSM UI only from admin networks

1. In the *DSM web UI and Web API* row choose **Selected networks**
   and tick your management network.
2. **Only these:** add your admin subnets, one per line.
3. Click **Apply**. NetAssign refuses the change if it would lock out
   the session you are using.

### Lift a restriction

Set the service back to **Not decided (tbd)**, or to **All networks**
with **Any source**, and click **Apply**.

### Several changes at once

Make all edits, then click **Apply all**. They are applied in a safe
order: sub-interfaces removed, then added, then firewall changes. A
single confirmation covers all of them.

## Plan files (Import / Export JSON)

**Export JSON** saves the current draft. **Import JSON** loads a plan.
Rows that differ from the live state then show up as changes. Nothing
is applied until you click Apply. Services the plan doesn't mention
become *Not decided*.

```json
{
  "name": "Example: storage VLAN and restricted SMB",
  "description": "Optional text shown after import.",
  "notes": ["Optional notes, shown as a list after import."],
  "plan": {
    "version": 1,
    "interfaces": {
      "ovs_eth0": {
        "networks": [
          { "vlan": 100, "tagged": false, "address": "192.168.100.21/24", "gateway": "192.168.100.1" },
          { "vlan": 131, "tagged": true,  "address": "192.168.131.21/24", "gateway": "192.168.131.1" }
        ]
      }
    },
    "defaultRoute": "ovs_eth0",
    "services": {
      "dsm": { "mode": "networks", "networks": ["ovs_eth0"], "sources": ["192.168.100.0/24"] },
      "smb": { "mode": "networks", "networks": ["ovs_eth0.131"], "sources": [] },
      "hbvault": { "mode": "blocked", "networks": [], "sources": [] }
    }
  }
}
```

| Key | Values |
|---|---|
| `mode` | `tbd`, `networks`, `any`, `blocked` |
| `networks` | Network keys: an interface name for the untagged network (`ovs_eth0`, `eth0`, `bond0`), `<interface>.<vlan>` for a tagged one |
| `sources` | `[]` = any source; a list of addresses/subnets; `null` = not decided |
| `defaultRoute` | The network key holding the default gateway. Informational: NetAssign doesn't move it |

Service IDs:

| ID | Service |
|---|---|
| `dsm` | DSM web UI and Web API |
| `web` | Web Station / Login Portal 80/443 |
| `ssh` | SSH |
| `snmp` | SNMP |
| `rsync` | rsync |
| `smb` | SMB/CIFS |
| `wsd` | WS-Discovery |
| `afp` | AFP |
| `nfs` | NFS |
| `ftp` | FTP/FTPS |
| `sftp` | SFTP |
| `webdav` | WebDAV |
| `iscsi` | iSCSI target |
| `drive` | Synology Drive client sync |
| `hbvault` | Hyper Backup Vault |
| `replication` | Snapshot Replication |
| `mediaserver` | Media Server |
| `airplay` | Audio Station AirPlay |
| `caldav` | Synology Calendar (CalDAV) |
| `carddav` | Synology Contacts (CardDAV) |
| `hybridshare` | Hybrid Share |
| `vmm` | Virtual Machine Manager cluster |
| `portal:<app id>` | A Login Portal application with its own port, e.g. `portal:SYNO.SDS.App.FileStation3.Instance` |

## Good to know

- **Login Portal aliases:** apps such as Audio Station, Chat or File
  Station are also reachable through aliases like `/audio` on ports 80,
  443, 5000 and 5001. Those follow the restriction of the DSM web UI,
  not of the app. To separate an app completely, remove its alias under
  *Control Panel → Login Portal → Applications*.
- **DSM firewall:** NetAssign's restrictions are independent of the
  DSM firewall and work whether it is on or off. After you toggle the
  DSM firewall, NetAssign re-applies its chain within about 30
  seconds.
- **IPv4 only:** restrictions apply to IPv4 traffic.
- **DoS protection:** DSM rebuilds its own iptables rules on network
  changes. Check DSM's DoS protection setting (*Control Panel →
  Security → Protection*) after changing networks.
