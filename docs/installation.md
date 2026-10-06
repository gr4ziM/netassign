# Installation

## Requirements

| Requirement | Why | Notes |
|---|---|---|
| DSM 7.0 or later | DSM 7 package format | Tested on DSM 7.4-90075. Uses DSM's built-in Python 3 (`/usr/bin/python3`); nothing else to install. |
| Any architecture | The package is `noarch` | Tested on a DS916+ (x86_64). |
| An administrator account | Only administrators can open NetAssign and apply changes | The account must be in the `administrators` group. |
| SSH access with root rights (once, and after each update) | Installs the root helper; DSM 7 packages cannot run as root | *Control Panel → Terminal & SNMP → Enable SSH service*. Sign in as an administrator and use `sudo -i`. You can disable SSH again afterwards. |
| **Virtual Machine Manager**, i.e. Open vSwitch enabled | Needed for **VLAN sub-interfaces** (several VLANs on one port) | Installing Virtual Machine Manager enables Open vSwitch. Where your DSM offers it, you can also enable it under *Control Panel → Network → Network Interface → Manage → Open vSwitch Settings*. Without Open vSwitch, NetAssign still shows status and can restrict services, but cannot add sub-interfaces. |
| Switch ports that carry the VLANs | A sub-interface only works if the switch delivers that VLAN tagged on the port | Configure the switch first. NetAssign does not configure switches. |
| A modern browser | The UI runs in the DSM desktop | Any current Chrome, Edge, Firefox or Safari. |

**Before you start:** keep a second way to reach your DiskStation while
you try out restrictions. That can be a second network interface, a
different subnet, or physical access. NetAssign refuses changes that
would cut the session you apply them from, and it reverts unconfirmed
changes after 5 minutes. A second path is still good practice.

## 1. Install the package

**Package Center (recommended):**

1. Download `NetAssign-<version>-noarch.spk` and its `.sha256` file
   from the [Releases](https://github.com/gr4ziM/netassign/releases)
   page.
2. *Package Center → Manual Install* → select the file → **Next**.
3. Accept the warning that the package was not published by Synology.
4. Finish the wizard and make sure the package is **running**.

**Command line (alternative):** copy the `.spk` to a shared folder,
then as root:

```bash
sha256sum /volume1/<share>/NetAssign-<version>-noarch.spk   # compare with the published checksum
synopkg install /volume1/<share>/NetAssign-<version>-noarch.spk
synopkg start NetAssign
```

## 2. Open NetAssign

Open **NetAssign** from the DSM main menu. If the icon doesn't show up,
reload DSM in the browser (F5) and check that the package is running.

At this point NetAssign shows the status tabs. Applying changes needs
the root helper.

## 3. Install the root helper

DSM 7 packages run as an unprivileged package user. Everything that
needs root — creating sub-interfaces and changing iptables — is done by
a small helper that you install yourself. NetAssign never gains root on
its own.

**3a. Copy the helper to its root-owned location and start it.** Sign
in over SSH as an administrator:

```bash
sudo -i
/var/packages/NetAssign/target/bin/netassign-helper install
```

This copies the helper to `/usr/local/libexec/netassign/` (owner root,
mode 0755) and starts it. Expected output:

```
installed /usr/local/libexec/netassign/netassign-helper <version>
not running
netassign-helper <version> started (pid …)
```

**3b. Start it at every boot.** Use *Control Panel → Task Scheduler →
Create → Triggered Task → User-defined script*:

- *General*:
  - task name `NetAssign helper`,
  - user **root**,
  - event **Boot-up**,
  - enabled.
- *Task Settings → Run command*:
  ```
  /usr/local/libexec/netassign/netassign-helper start
  ```

**3c. Check it.** In NetAssign, open the **Helper** tab:

1. **Status** should be *running*, with the same version as the
   package.
2. Click **Run read-only check**. It lists Open vSwitch, addresses,
   policy routing and iptables. Every entry should show *exit 0*.

## Updating

1. Install the new `.spk` over the old one. Your sub-interfaces and
   restrictions are kept.
2. Run `netassign-helper install` again (step 3a). The helper never
   reloads package code by itself, for security reasons. Until you do
   this, the Helper tab shows the helper as **outdated** and Apply is
   disabled.
3. Reload DSM in the browser if the window looks outdated.

## Uninstalling

Sub-interfaces and service restrictions stay active until the helper
removes them. Uninstall in this order:

1. As root:
   ```bash
   /var/packages/NetAssign/target/bin/netassign-helper uninstall
   ```
   This stops the helper and removes:
   - all sub-interfaces NetAssign created,
   - the `NETASSIGN` firewall chain,
   - the root-owned helper copy, its state and its log.
2. Delete the **NetAssign helper** task in Task Scheduler.
3. Uninstall NetAssign in Package Center.

If you uninstall the package first, the helper stops on its own. The
sub-interfaces and firewall chain it created then stay until the next
reboot, and the files in `/usr/local/libexec/netassign/` and
`/usr/local/etc/netassign/` remain. To clean up afterwards, reinstall
the package and follow the steps above.
