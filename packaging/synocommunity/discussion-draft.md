# Draft: question to the spksrc maintainers

Post as a GitHub issue or discussion in
https://github.com/SynoCommunity/spksrc before porting.

---

**Title:** New package proposal: NetAssign (DSM 7 network/service assignment) — acceptable with an admin-installed root helper?

Hi,

I'd like to contribute **NetAssign**, a `noarch` DSM 7 app (MIT
licensed, source: https://github.com/gr4ziM/netassign). It shows the network and firewall
configuration and lets administrators:

- add VLAN sub-interfaces (Open vSwitch internal ports),
- restrict DSM services to selected networks and source addresses (a
  dedicated iptables chain).

Every change takes a snapshot first and reverts automatically after 5
minutes unless it is confirmed.

Before I port it to spksrc, I'd like to check whether its design fits
SynoCommunity's DSM 7 rules:

- The package itself runs entirely as its package user. Its scripts do
  nothing as root.
- Changes need root (`ovs-vsctl`, `ip`, `iptables`). For that, the
  administrator **manually** installs a helper once over SSH:
  `sudo …/bin/netassign-helper install`. This copies the helper to a
  root-owned location (`/usr/local/libexec/netassign`). The admin then
  adds a Task Scheduler boot-up task that starts it.
- The UI talks to the helper only through the package's CGI. The CGI
  accepts signed-in DSM administrators only (`authenticate.cgi` plus
  membership in `administrators`).
- The helper validates every request against a fixed action list.
  Root never executes the package-user-writable copy.
- Without the helper, NetAssign is a read-only status tool.

Would a package with such an optional, explicitly admin-installed root
component be acceptable for SynoCommunity? If yes, I'd follow up with
`cross/netassign` and `spk/netassign` in a PR. If not, I'll keep
distributing it via GitHub Releases.

Thanks!
