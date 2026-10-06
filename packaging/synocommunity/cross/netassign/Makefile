# DRAFT — not built or tested. Check against the current spksrc
# documentation before use; see ../../README.md for the open points.

PKG_NAME = netassign
PKG_VERS = 1.0.0
PKG_EXT = tar.gz
PKG_DIST_NAME = v$(PKG_VERS).$(PKG_EXT)
PKG_DIST_SITE = https://github.com/gr4ziM/netassign/archive/refs/tags
PKG_DIST_FILE = $(PKG_NAME)-$(PKG_VERS).$(PKG_EXT)
PKG_DIR = $(PKG_NAME)-$(PKG_VERS)

DEPENDS =

HOMEPAGE = https://github.com/gr4ziM/netassign
COMMENT = DSM 7 app to assign DSM services to network interfaces and VLANs.
LICENSE = MIT

# Nothing to compile: plain HTML/JS and Python 3 (DSM's /usr/bin/python3).
CONFIGURE_TARGET = nop
COMPILE_TARGET = nop
INSTALL_TARGET = netassign_install

include ../../mk/spksrc.cross-cc.mk

.PHONY: netassign_install
netassign_install:
	install -d -m 755 $(STAGING_INSTALL_PREFIX)/ui $(STAGING_INSTALL_PREFIX)/bin
	cp -R $(WORK_DIR)/$(PKG_DIR)/src/ui/. $(STAGING_INSTALL_PREFIX)/ui/
	rm -rf $(STAGING_INSTALL_PREFIX)/ui/app/tests $(STAGING_INSTALL_PREFIX)/ui/app/mock
	chmod 755 $(STAGING_INSTALL_PREFIX)/ui/app/api.cgi
	install -m 755 $(WORK_DIR)/$(PKG_DIR)/src/bin/netassign-helper $(STAGING_INSTALL_PREFIX)/bin/
