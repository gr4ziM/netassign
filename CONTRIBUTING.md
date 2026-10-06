# Contributing

Issues and pull requests are welcome. Code, comments, UI text and
documentation are in English.

## Repository layout

```
build.py                 builds dist/NetAssign-<version>-noarch.spk (Python 3.9+, standard library)
package/                 INFO template, privilege file, lifecycle scripts
src/ui/                  DSM integration: config, netassign.js (app window), icons are generated
src/ui/app/              the page: index.html, app.js, assign.js, helper.js, model.js, catalog.js, app.css, api.cgi
src/bin/netassign-helper root helper (Python 3.8, DSM's system interpreter)
tests/                   helper logic tests (unittest)
src/ui/app/tests/        browser tests for model.js
docs/                    user documentation
packaging/synocommunity/ notes and a draft for a SynoCommunity (spksrc) package
```

## Build

```bash
python build.py                        # default version from build.py
python build.py --version 1.0.1-0015
```

The build stamps the version into the helper and into all UI files.
Asset URLs carry `?v=<version>` because DSM serves package files without
cache headers.

## Tests

```bash
python -m unittest discover -s tests   # helper: rule generation, lock-out check, validation
```

Browser tests for `model.js` (validation and change detection):

```bash
python -m http.server 8765 --directory src/ui
# open http://localhost:8765/app/tests/model.test.html
```

## Local preview

`src/ui/app/index.html?mock=1` renders against
`src/ui/app/mock/fixtures.json` instead of a live DSM. That file is a
dict of DSM Web API responses keyed `"<api>.<method>.v<version>"`, with
firewall profiles under `"SYNO.Core.Security.Firewall.Profile.get.v1:<name>"`.
Add `&helper=alive` to simulate a running helper. Fixtures captured
from a real NAS contain network details, so `mock/` is gitignored.

```bash
python build.py --preview-icons                    # writes src/ui/images/ (gitignored)
python -m http.server 8765 --directory src/ui      # open /app/index.html?mock=1
```

## Rules that keep DSM intact

- **UI root:** DSM loads well-known files from a package's UI root
  (e.g. `style.css`) into the entire DSM desktop. Only `config`,
  `netassign.js` and `images/` may live in `src/ui/`; everything else
  belongs in `src/ui/app/`. `build.py` refuses to build otherwise.
- **The helper runs as root:**
  - treat every request as untrusted,
  - never follow paths the package user controls,
  - keep its file operations symlink-safe,
  - add a unit test for every new action.
- **Safety contract for new write paths:** each change needs a
  snapshot, a rollback on failure, and the pending/confirm/revert
  cycle.
- **No DSM request signing:** don't reimplement DSM's request signing
  (`X-SYNO-HASH`). Use DSM's own tools from the helper instead.
