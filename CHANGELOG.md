# Changelog

All notable changes to NetAssign. Versions follow `MAJOR.MINOR.PATCH-BUILD`, the DSM package version format.

## 1.0.0-0014 — first public release

### Features

- **Status overview:**
  - interfaces, routing, DNS, Open vSwitch, VMM virtual switches and
    DSM firewall profiles,
  - findings about exposure,
  - a service inventory with live ports and current reachability.
- **Assignment tab** as the single place for changes:
  - the draft starts from the live configuration,
  - changed rows are highlighted,
  - per-row **Apply** and **Apply all**,
  - Import/Export JSON for plans.
- **VLAN sub-interfaces:** Open vSwitch internal ports with a VLAN tag,
  their address and a source-based route table. Requires Open vSwitch.
- **Per-service restrictions:**
  - allow a service on selected networks, optionally only from
    selected sources, or block it everywhere,
  - implemented in NetAssign's own iptables chain, independent of the
    DSM firewall,
  - works on Open vSwitch bridges and on plain `ethN`/`bondN` ports.
- **Safe changes:**
  - validation of the whole resulting state,
  - a snapshot before every change,
  - automatic revert after 5 minutes unless confirmed,
  - lock-out protection for the session that applies the change.
- **Persistence:** managed sub-interfaces and restrictions are restored
  at boot and whenever DSM rebuilds networking or iptables.
- **Root helper** with explicit installation, a root-owned copy,
  strict request validation, and `install`/`start`/`stop`/`status`/`uninstall`
  commands.

### Known limitations

- NetAssign does not change a port's own (untagged) address or the
  default route; use *Control Panel → Network*.
- Service restrictions are IPv4 only.
- Login Portal aliases on ports 80/443/5000/5001 follow the DSM web UI's
  restriction.
- Verified on hardware with Open vSwitch only (DS916+, DSM 7.4-90075).
  Plain-port restrictions without Open vSwitch are covered by tests.
