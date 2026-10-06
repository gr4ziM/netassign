"""Logic tests for the root helper's firewall code (rule generation,
lock-out check, input validation). Linux commands are faked, so this
runs anywhere:

    python -m unittest discover -s tests
"""

import importlib.machinery
import importlib.util
import sys
import types
import unittest
from pathlib import Path

HELPER = Path(__file__).resolve().parent.parent / "src" / "bin" / "netassign-helper"


def load_helper():
    sys.modules.setdefault("fcntl", types.ModuleType("fcntl"))   # Linux-only import, unused here
    loader = importlib.machinery.SourceFileLoader("netassign_helper", str(HELPER))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader("netassign_helper", loader))
    loader.exec_module(module)
    return module


H = load_helper()

# Example DiskStation: two OVS bridges plus a managed VLAN 131 port.
def fake_run(argv, timeout=15):
    out = ""
    if argv[:2] == ["ovs-vsctl", "list-br"]:
        out = "ovs_eth0\novs_eth1\n"
    elif argv[:4] == ["ip", "-4", "-o", "addr"]:
        out = ("6: ovs_eth0    inet 192.168.100.21/24 brd x\n7: ovs_eth1    inet 192.168.20.21/24 brd x\n"
               "16: na0v131    inet 192.168.131.21/24 scope global\n")
    return {"argv": argv, "exit_code": 0, "stdout": out, "stderr": ""}


H.run = fake_run
# With OVS, DSM's eth ports are bridge members, so no plain ports count.
H.net_devices = lambda: [("eth0", True), ("eth1", True), ("lo", False)]
EST = ["-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED"]


def policy(**kw):
    base = {"ports": [{"proto": "tcp", "ports": "22"}], "mode": "blocked"}
    base.update(kw)
    return H.validate_policy(base)


class FirewallRules(unittest.TestCase):
    def setUp(self):
        note = policy(service="note", ports=[{"proto": "tcp", "ports": "9350"}], mode="networks", networks=["ovs_eth1"])
        dsm = policy(service="dsm", ports=[{"proto": "tcp", "ports": "5000"}, {"proto": "tcp", "ports": "5001"}],
                     mode="networks", networks=["ovs_eth0", "ovs_eth1"], sources=["192.168.100.7", "192.168.105.0/24"])
        self.state = {"subinterfaces": [{"key": "ovs_eth0.131", "ifname": "na0v131"}], "firewall": {"note": note, "dsm": dsm}}
        self.rules = [" ".join(r) for r in H.chain_rules(self.state, EST)]

    def test_loopback_and_established_come_first(self):
        self.assertEqual(self.rules[0], "-i lo -j RETURN")
        self.assertTrue(self.rules[1].endswith("ESTABLISHED,RELATED -j RETURN"))

    def test_service_dropped_only_off_its_networks(self):
        self.assertIn("-i ovs_eth0 -p tcp -m multiport --dports 9350 -j DROP", self.rules)
        self.assertIn("-i na0v131 -p tcp -m multiport --dports 9350 -j DROP", self.rules)
        self.assertFalse(any("ovs_eth1" in r and "9350" in r for r in self.rules))

    def test_sources_are_allowed_before_the_drop(self):
        allow = self.rules.index("-i ovs_eth0 -s 192.168.100.7/32 -p tcp -m multiport --dports 5001 -j RETURN")
        drop = self.rules.index("-i ovs_eth0 -p tcp -m multiport --dports 5001 -j DROP")
        self.assertLess(allow, drop)

    def test_port_ranges_use_colons(self):
        state = {"subinterfaces": [], "firewall": {"a": policy(service="a", ports=[{"proto": "tcp", "ports": "6011-6030"}])}}
        self.assertTrue(any("6011:6030" in " ".join(r) for r in H.chain_rules(state, EST)))


class LockOut(unittest.TestCase):
    def setUp(self):
        dsm = policy(service="dsm", ports=[{"proto": "tcp", "ports": "5001"}], mode="networks",
                     networks=["ovs_eth0", "ovs_eth1"], sources=["192.168.105.0/24"])
        self.state = {"subinterfaces": [], "firewall": {"dsm": dsm}}

    def test_allowed_admin_passes(self):
        H.check_lockout(self.state, {"client": "192.168.105.20", "server_addr": "192.168.100.21", "server_port": "5001"})

    def test_admin_outside_sources_is_refused(self):
        with self.assertRaises(RuntimeError):
            H.check_lockout(self.state, {"client": "192.168.106.5", "server_addr": "192.168.100.21", "server_port": "5001"})

    def test_non_ipv4_origin_is_skipped(self):
        H.check_lockout(self.state, {"client": "fe80::1", "server_addr": "fe80::2", "server_port": "5001"})


class JumpRelocatedByDsm(unittest.TestCase):
    """DSM moves our INPUT jump into its DEFAULT_INPUT chain."""

    def setUp(self):
        self.calls = []
        self.listing = "-P INPUT ACCEPT\n-N DEFAULT_INPUT\n-N NETASSIGN\n-A INPUT -j DEFAULT_INPUT\n-A DEFAULT_INPUT -j NETASSIGN\n"
        self.chain = "-N NETASSIGN\n-A NETASSIGN -i lo -j RETURN\n"

        def run(argv, timeout=15):
            self.calls.append(argv)
            out = ""
            if argv == ["iptables", "-S"]:
                out = self.listing
            elif argv == ["iptables", "-S", "NETASSIGN"]:
                out = self.chain
            return {"argv": argv, "exit_code": 0, "stdout": out, "stderr": ""}

        self.saved = H.run
        H.run = run

    def tearDown(self):
        H.run = self.saved
        H._fw_fingerprint = None

    def test_jump_is_found_in_default_input(self):
        self.assertEqual(H.jump_chains(), ["DEFAULT_INPUT"])

    def test_clearing_removes_the_relocated_jump(self):
        H.fw_apply({"subinterfaces": [], "firewall": {}})
        self.assertIn(["iptables", "-D", "DEFAULT_INPUT", "-j", "NETASSIGN"], self.calls)

    def test_reconcile_leaves_a_relocated_but_intact_chain_alone(self):
        H._fw_fingerprint = self.chain
        state = {"subinterfaces": [], "firewall": {"x": policy(service="x")}}
        H.fw_reconcile(state)
        self.assertNotIn(["iptables", "-F", "NETASSIGN"], self.calls)
        self.assertFalse(any(c[:3] == ["iptables", "-I", "INPUT"] for c in self.calls))


class PlainPortsWithoutOvs(unittest.TestCase):
    """Without Open vSwitch, DSM's ports are ethN/bondN themselves."""

    def setUp(self):
        self.saved = (H.run, H.net_devices)
        H.run = lambda argv, timeout=15: {"argv": argv, "exit_code": 1 if argv[:2] == ["ovs-vsctl", "list-br"] else 0,
                                          "stdout": "", "stderr": ""}
        # eth2/eth3 are members of bond0; docker0 and lo are not DSM ports.
        H.net_devices = lambda: [("bond0", False), ("docker0", False), ("eth0", False), ("eth1", False),
                                 ("eth2", True), ("eth3", True), ("lo", False)]

    def tearDown(self):
        H.run, H.net_devices = self.saved

    def test_plain_ports_and_bonds_are_networks_but_members_are_not(self):
        self.assertEqual(H.base_networks(), {"bond0": "bond0", "eth0": "eth0", "eth1": "eth1"})

    def test_rules_use_the_plain_interfaces(self):
        state = {"subinterfaces": [], "firewall": {"ssh": policy(service="ssh", mode="networks", networks=["eth0"])}}
        rules = [" ".join(r) for r in H.chain_rules(state, EST)]
        self.assertIn("-i eth1 -p tcp -m multiport --dports 22 -j DROP", rules)
        self.assertIn("-i bond0 -p tcp -m multiport --dports 22 -j DROP", rules)
        self.assertFalse(any(" -i eth0 " in f" {r} " for r in rules))


class Validation(unittest.TestCase):
    def test_rejects_bad_input(self):
        bad = [
            dict(service="x;rm"),
            dict(service="x", ports=[{"proto": "icmp", "ports": "1"}]),
            dict(service="x", ports=[{"proto": "tcp", "ports": "1-2,3-4,5-6,7-8,9-10,11-12,13-14,15-16"}]),
            dict(service="x", ports=[{"proto": "tcp", "ports": "0"}]),
            dict(service="x", mode="any", sources=[]),
            dict(service="x", mode="networks", networks=[]),
            dict(service="x", mode="networks", networks=["ovs_eth0"], sources=["10.0.0.300/8"]),
        ]
        for case in bad:
            with self.subTest(case=case), self.assertRaises(ValueError):
                policy(**case)

    def test_multiport_limit_is_15_slots(self):
        H.parse_port_spec("1-2,3-4,5-6,7-8,9-10,11-12,13-14,15")
        H.parse_port_spec("2379-2382,2385,16509,16514,30200-30300")

    def test_sources_are_normalized(self):
        self.assertEqual(H.parse_source("192.168.100.77/24"), "192.168.100.0/24")
        self.assertEqual(H.parse_source("1.2.3.4"), "1.2.3.4/32")


if __name__ == "__main__":
    unittest.main()
