# DRAFT — not built or tested. Check against the current spksrc
# documentation before use; see ../../README.md for the open points.

SPK_NAME = netassign
SPK_VERS = 1.0.0
SPK_REV = 1
SPK_ICON = src/netassign.png

DEPENDS = cross/netassign

override ARCH = noarch
REQUIRED_MIN_DSM = 7.0

MAINTAINER = gr4ziM
DESCRIPTION = Network and firewall status at a glance. Assign DSM services to network interfaces and VLANs, add VLAN sub-interfaces and restrict services per network, with snapshots and automatic revert unless confirmed. Write features need a root helper that the administrator installs once over SSH.
DISPLAY_NAME = NetAssign
CHANGELOG = "Initial package release."
HOMEPAGE = https://github.com/gr4ziM/netassign
LICENSE = MIT

# No background service: the UI is served by DSM itself.
STARTABLE = no

# DSM UI integration (relative to /var/packages/$(SPK_NAME)/target/)
DSM_UI_DIR = ui
DSM_UI_CONFIG = src/ui/config

POST_STRIP_TARGET = netassign_stamp_version

include ../../mk/spksrc.spk.mk

# NetAssign's own build stamps the package version into the helper and
# the UI (asset cache-busting, helper version check). Without it the UI
# reports the helper as outdated.
.PHONY: netassign_stamp_version
netassign_stamp_version:
	@$(MSG) "Stamping version $(SPK_VERS)-$(SPK_REV)"
	find $(STAGING_DIR)/ui $(STAGING_DIR)/bin -type f -exec sed -i "s/@VERSION@/$(SPK_VERS)-$(SPK_REV)/g" {} +
