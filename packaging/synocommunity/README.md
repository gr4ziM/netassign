# Publishing NetAssign through SynoCommunity

[SynoCommunity](https://synocommunity.com) publishes community packages
at `packages.synocommunity.com`. Its packages are built from source with
the [spksrc](https://github.com/SynoCommunity/spksrc) framework and
signed by SynoCommunity. You don't upload a finished `.spk`. You
contribute build recipes to spksrc through a pull request.

## Can NetAssign be accepted? Ask first

SynoCommunity's DSM 7 rules state:

> packages are executed with `package` permissions

They list root operations in install and startup scripts as
unsupported ([spksrc wiki: DSM 7.0](https://github.com/SynoCommunity/spksrc/wiki/DSM-7.0)).

The NetAssign package itself follows this rule: it runs as its package
user, and its scripts do nothing as root. But its write features only
work after the administrator manually installs a **root helper** over
SSH. Whether the maintainers accept a package built around an
admin-installed root component is a policy question, so **ask before
porting**. A ready-to-post question is in
[`discussion-draft.md`](discussion-draft.md).

If they decline, distribute NetAssign yourself instead:
- publish the `.spk` on your project's GitHub *Releases* page, with its
  SHA-256 checksum,
- users install it with *Package Center → Manual Install*,
- many community DSM apps are distributed this way.

## What a SynoCommunity contribution involves

From the [Developers HOW-TO](https://github.com/SynoCommunity/spksrc/wiki/Developers-HOW-TO)
and the [contribution guidelines](https://github.com/SynoCommunity/spksrc/blob/master/CONTRIBUTING.md):

1. **Public upstream source:** NetAssign needs a public GitHub
   repository with a tagged release, e.g. `v1.0.0`. spksrc downloads
   the source archive of that tag.
2. **Build recipe** in a fork of spksrc:
   - `cross/netassign/Makefile` downloads the tagged source
     (`PKG_DIST_SITE`, `PKG_DIST_NAME`, …) and installs the files.
     `make digests` creates the checksum file for the download.
   - `spk/netassign/Makefile` holds the package metadata (`SPK_NAME`,
     `SPK_VERS`, `SPK_REV`, `SPK_ICON`, `MAINTAINER`, `DESCRIPTION`,
     `DISPLAY_NAME`, `CHANGELOG`, `HOMEPAGE`, `LICENSE`), sets
     `override ARCH=noarch`, and sets the DSM UI integration
     (`DSM_UI_DIR`, `DSM_UI_CONFIG`).
3. **Build and test** with the spksrc Docker image:
   - `make all-supported` (for `noarch`, one build),
   - install with `sudo synopkg install …`,
   - test an upgrade (install the same version again),
   - make sure no errors appear in `/var/log/packages/netassign.log`.
4. **Pull request:** create a branch in your fork (not `master`) and open
   a pull request using SynoCommunity's template and checklist.
5. **Maintainer role:** `MAINTAINER` is your GitHub handle. You are
   expected to answer issues for the package and to submit updates.

Drafts of both Makefiles are in [`spk/`](spk/) and [`cross/`](cross/).
**They have not been built.** Check them against the current spksrc
documentation and a working example, such as
[`spk/owncloud`](https://github.com/SynoCommunity/spksrc/blob/master/spk/owncloud/Makefile)
for DSM UI integration.

## Changes NetAssign needs before a spksrc build

| Today | spksrc expectation | What to change |
|---|---|---|
| Package name `NetAssign` is hard-coded in the helper (`/var/packages/NetAssign/var`), `api.cgi`, `netassign.js` (iframe URL `/webman/3rdparty/NetAssign/app/…`) and `helper.js` (paths in the setup text) | Lower-case `SPK_NAME` (`netassign`); the package user is `sc-netassign` | Make the package name a single build-time placeholder (like `@VERSION@`), or derive it at runtime (`api.cgi` can read its own path) |
| `build.py` stamps `@VERSION@` into the helper and the UI files | spksrc doesn't run `build.py` | Stamp the version in the spk Makefile (`POST_STRIP_TARGET`, see the draft). Without it, the UI reports the helper as *outdated* and disables Apply. |
| `build.py` generates the app icons | spksrc expects `SPK_ICON` (a PNG); it can generate the DSM icon sizes from it | Commit a 256×256 PNG (`python build.py --preview-icons` writes it to `src/ui/images/netassign_256.png`) |
| Own `start-stop-status` (startable, no daemon) | spksrc generates scripts; `STARTABLE = no` for packages without a service | Check that the app icon still appears with `STARTABLE = no` |

## Suggested order

1. Choose the account and identity you want to publish under (see
   below).
2. Publish this repository on GitHub, tag `v1.0.0`, and attach the
   `.spk` and its checksum to the release.
3. Post the question from [`discussion-draft.md`](discussion-draft.md)
   in spksrc's issues or discussions.
4. Only if the answer is positive: make the changes above, finish the
   Makefile drafts, build with spksrc, and open the pull request.

### Identity

The copyright line in `LICENSE`, `MAINTAINER` and your git commits are
public. Use the name and e-mail you want to be known by. GitHub's
`…@users.noreply.github.com` address keeps your real e-mail private.
