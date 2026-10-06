# NetAssign

**Decide which DSM services are reachable on which network — on your
Synology DiskStation, from the DSM desktop.**

NetAssign is a DSM 7 app for administrators. It does three things:

- **Overview:** it shows the network and firewall configuration at a
  glance, with every DSM service, its real ports and where it is
  reachable right now.
- **Changes:** it lets you add VLAN sub-interfaces and restrict
  services to selected networks and source addresses.
- **Safety:** every change is applied safely.

| Feature | What it gives you |
|---|---|
| Status overview | Interfaces, addresses, gateways, DNS, VLAN tags, Open vSwitch, VMM virtual switches, DSM firewall profiles, and findings such as "the DSM UI answers on every interface" |
| Service inventory | Every DSM service and package service with its live ports (DSM, SMB, iSCSI, WebDAV, Drive, Hyper Backup Vault, Login Portal apps, …) and its current exposure |
| VLAN sub-interfaces | Several VLANs on one physical port. DSM itself allows only one VLAN tag per port |
| Per-service restrictions | Allow a service only on selected networks, optionally only from selected source networks, or block it everywhere |
| Safe changes | Per-row **Apply** and **Apply all**, a snapshot before every change, and automatic revert after 5 minutes unless you confirm. Changes that would cut your own DSM session are refused |
| Persistence | Sub-interfaces and restrictions are restored at boot and after DSM rebuilds its network or firewall rules |
| Plans as files | Export and import the target configuration as JSON |

> ⚠️ NetAssign changes the network and firewall setup of your
> DiskStation. Read the [installation guide](docs/installation.md) and
> the [user guide](docs/user-guide.md) first, and keep another way to
> reach your NAS (a second interface or physical access) while you
> experiment.

## Quick start

1. Check the [requirements](docs/installation.md#requirements):
   - DSM 7,
   - an administrator account with SSH access,
   - Virtual Machine Manager (Open vSwitch) for VLAN sub-interfaces.
2. Download `NetAssign-<version>-noarch.spk` from the
   [Releases](https://github.com/gr4ziM/netassign/releases) page and
   install it via *Package Center → Manual Install*.
3. Install the root helper once over SSH:
   ```bash
   sudo /var/packages/NetAssign/target/bin/netassign-helper install
   ```
   Then add the boot-up task in Task Scheduler
   ([details](docs/installation.md#3-install-the-root-helper)).
4. Open **NetAssign** from the DSM main menu → **Assignment** tab.

## Documentation

| Document | Contents |
|---|---|
| [docs/installation.md](docs/installation.md) | Requirements, installing the package and the root helper, updating, uninstalling |
| [docs/user-guide.md](docs/user-guide.md) | All tabs and features, step-by-step configuration examples, the plan file format |
| [docs/how-it-works.md](docs/how-it-works.md) | Architecture, what exactly is changed on the system, security model |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common problems and how to fix them |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Building from source, tests, local preview |
| [SECURITY.md](SECURITY.md) | Reporting security issues |

## Compatibility

Tested on a DS916+ (x86_64) with DSM 7.4-90075 and Open vSwitch
enabled. The package is architecture-independent (`noarch`) and
declares DSM 7.0 as its minimum. Feedback from other models and DSM
versions is welcome.

## License

[MIT](LICENSE). NetAssign is an independent project and is not
affiliated with or endorsed by Synology Inc.
