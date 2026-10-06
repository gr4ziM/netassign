# Troubleshooting

## Installation

| Symptom | Cause / fix |
|---|---|
| Manual Install fails with "Operation failed. Please log in to DSM again" | The upload didn't arrive completely. This is often caused by a proxy or endpoint security software on the client. Copy the `.spk` to a shared folder and install it over SSH instead (see [installation](installation.md#1-install-the-package)). |
| `synopkg install` → error 263 "the spk might not exist or invalid format" | The file is incomplete, often a 0-byte copy. Compare `sha256sum` with the published checksum and copy it again. |
| NetAssign icon missing in the main menu | The package isn't running (`synopkg start NetAssign`), or DSM needs a reload (F5). |

## Helper

| Symptom | Cause / fix |
|---|---|
| Helper tab: **not set up** | The helper has never run. Do [step 3](installation.md#3-install-the-root-helper). |
| Helper tab: **not running** | The helper stopped, or the NAS rebooted without the Task Scheduler task. Run `/usr/local/libexec/netassign/netassign-helper start` as root and check the boot-up task. |
| Helper tab: **outdated** | The package was updated but the helper wasn't. Run `/var/packages/NetAssign/target/bin/netassign-helper install` as root. |
| Helper tab: **unreachable** / "api.cgi returned HTTP …" | DSM couldn't run the package CGI. Restart the package and reload DSM. |
| The helper exits right after starting | Look at `/var/log/netassign-helper.log` (root). The helper refuses to run from a location that isn't root-only and logs why. |

## Applying changes

| Symptom | Cause / fix |
|---|---|
| Apply is disabled | The reason is shown under the button. Typical reasons: the helper isn't running or is outdated, another change is pending, sources are still *Not decided*, the network doesn't exist live yet, Open vSwitch isn't enabled (sub-interfaces only). |
| "refused: … would block your own connection" | The change would drop the session you applied it from. Allow your current network or source, or apply from another network that stays allowed. |
| A sub-interface exists but nothing answers on it | The switch port doesn't carry that VLAN tagged, or the gateway doesn't exist. Check the switch configuration; the Apply result in the Helper tab includes a gateway ping. |
| A share or iSCSI target stopped working after a restriction | Clients still use an address on a network where the service is now blocked. Point them to an address on an allowed network, or extend the restriction. |
| A restriction seems not to work for a few seconds after toggling the DSM firewall | DSM rebuilt its iptables rules. The helper re-applies NetAssign's chain within about 30 seconds. |
| Login Portal app still reachable on a blocked network | It is also reachable through its alias (e.g. `/audio`) on ports 80/443/5000/5001, which follow the DSM web UI's restriction. Remove the alias in the Login Portal. |
| DSM's DoS protection is missing after a network change | DSM rebuilt its iptables rules. Re-apply the setting under *Control Panel → Security → Protection*. |

## Recovering

- **Undo the last change:** use **Revert now** in the banner, or wait 5
  minutes without confirming.
- **Locked out of the DSM UI** after confirming a change: connect over
  SSH, or through any network the DSM UI is still allowed on, and run
  as root:
  ```bash
  /usr/local/libexec/netassign/netassign-helper stop
  iptables -D DEFAULT_INPUT -j NETASSIGN 2>/dev/null; iptables -D INPUT -j NETASSIGN 2>/dev/null
  iptables -F NETASSIGN; iptables -X NETASSIGN
  ```
  This removes all service restrictions until the helper starts again,
  at the latest at the next boot. To remove them permanently, run
  `netassign-helper uninstall`.
- **Last resort:** Synology's reset button (mode 1, press about 4
  seconds) resets the network settings and the admin password. It does
  not erase data. It does not remove NetAssign's helper task, so
  connect over SSH afterwards and run the commands above or
  `netassign-helper uninstall`.
