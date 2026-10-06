#!/usr/bin/env python3
"""Build the NetAssign DSM package (.spk).

Usage:
    python build.py [--version X.Y.Z-NNNN]

Produces dist/NetAssign-<version>-noarch.spk. Pure standard library, so
it runs anywhere Python 3.9+ is available (no Synology toolkit needed).

SPK layout (an uncompressed tar):
    INFO                   package metadata
    package.tgz            gzip tar extracted to /var/packages/NetAssign/target
    conf/privilege         DSM 7 privilege spec (run as the package user)
    scripts/*              lifecycle hooks
    PACKAGE_ICON.PNG       64x64
    PACKAGE_ICON_256.PNG   256x256
"""

from __future__ import annotations

import argparse
import gzip
import io
import struct
import tarfile
import time
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UI_DIR = ROOT / "src" / "ui"
BIN_DIR = ROOT / "src" / "bin"
PKG_DIR = ROOT / "package"
DIST = ROOT / "dist"

DEFAULT_VERSION = "1.0.0-0014"
APP_ICON_SIZES = (16, 24, 32, 48, 64, 72, 256)
LIFECYCLE_HOOKS = ("preinst", "postinst", "preuninst", "postuninst", "preupgrade", "postupgrade")
# DSM loads files from a package's UI root into the whole DSM desktop
# (a root-level style.css once restyled every DSM window). Only the
# desktop integration may live there; the iframe page lives in app/.
UI_ROOT_ALLOWED = {"config", "netassign.js", "app", "images", "mock"}


# ---------------------------------------------------------------- icons

def _png(width: int, height: int, rgba: bytes) -> bytes:
    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    stride = width * 4
    raw = b"".join(b"\x00" + rgba[y * stride:(y + 1) * stride] for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def _dist_to_segment(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def render_icon(size: int) -> bytes:
    """A blue rounded tile with one uplink node fanning out to three
    interface nodes — drawn procedurally so no binary assets live in
    the repo. 4x4 supersampling for anti-aliasing."""
    ss = 4
    n = size * ss
    # Geometry in unit coordinates (0..1).
    radius = 0.2
    top = (0.5, 0.3)
    bottoms = [(0.24, 0.72), (0.5, 0.72), (0.76, 0.72)]
    node_r = 0.085
    line_w = 0.045

    acc = bytearray(size * size * 4)
    for y in range(n):
        v = (y + 0.5) / n
        for x in range(n):
            u = (x + 0.5) / n
            # Rounded-square mask.
            qx = max(abs(u - 0.5) - (0.5 - radius), 0.0)
            qy = max(abs(v - 0.5) - (0.5 - radius), 0.0)
            if (qx * qx + qy * qy) ** 0.5 > radius:
                continue
            # Vertical gradient background.
            r, g, b = int(10 + 20 * v), int(110 - 40 * v), int(209 - 50 * v)
            on_glyph = any(
                ((u - cx) ** 2 + (v - cy) ** 2) ** 0.5 <= node_r for cx, cy in [top, *bottoms]
            ) or any(_dist_to_segment(u, v, *top, *b2) <= line_w / 2 for b2 in bottoms)
            if on_glyph:
                r, g, b = 255, 255, 255
            i = ((y // ss) * size + (x // ss)) * 4
            acc[i] += r // (ss * ss)
            acc[i + 1] += g // (ss * ss)
            acc[i + 2] += b // (ss * ss)
            acc[i + 3] += 255 // (ss * ss)
    return _png(size, size, bytes(acc))


# ---------------------------------------------------------------- tar helpers

def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes, mode: int = 0o644) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.mtime = int(time.time())
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    tar.addfile(info, io.BytesIO(data))


def _add_dir(tar: tarfile.TarFile, name: str) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    info.mode = 0o755
    info.mtime = int(time.time())
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    tar.addfile(info)


def _text(path: Path) -> bytes:
    # Normalize to LF: DSM runs the scripts with /bin/sh.
    return path.read_bytes().replace(b"\r\n", b"\n")


def build_package_tgz(icons: dict[int, bytes], version: str) -> bytes:
    unexpected = sorted(p.name for p in UI_DIR.iterdir() if p.name not in UI_ROOT_ALLOWED)
    if unexpected:
        raise SystemExit(
            f"refusing to build: unexpected files in src/ui/ root: {unexpected}. "
            "DSM may inject UI-root files into the whole desktop; put page assets in src/ui/app/."
        )
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.GNU_FORMAT) as tar:
            _add_dir(tar, "ui")
            _add_dir(tar, "ui/images")
            for path in sorted(UI_DIR.rglob("*")):
                rel = path.relative_to(UI_DIR)
                # Local-preview files and tests never ship; icons are
                # generated fresh below instead of copied from src/ui/images.
                if rel.parts[0] == "images" or "mock" in rel.parts or "tests" in rel.parts:
                    continue
                arc = "ui/" + rel.as_posix()
                if path.is_dir():
                    _add_dir(tar, arc)
                else:
                    # DSM serves package files without Cache-Control, so
                    # browsers keep stale copies across upgrades: every
                    # asset URL carries ?v=@VERSION@, stamped here.
                    data = _text(path).replace(b"@VERSION@", version.encode())
                    # synoscgi only runs CGIs that are executable.
                    _add_bytes(tar, arc, data, 0o755 if path.suffix == ".cgi" else 0o644)
            for size, png in icons.items():
                _add_bytes(tar, f"ui/images/netassign_{size}.png", png)
            # Root helper, installed and registered by the administrator.
            _add_dir(tar, "bin")
            for path in sorted(BIN_DIR.iterdir()):
                data = _text(path).replace(b"@VERSION@", version.encode())
                _add_bytes(tar, f"bin/{path.name}", data, 0o755)
    return buf.getvalue()


def build(version: str) -> Path:
    icons = {s: render_icon(s) for s in APP_ICON_SIZES}
    package_tgz = build_package_tgz(icons, version)
    info = (
        _text(PKG_DIR / "INFO.in")
        .decode()
        .replace("@VERSION@", version)
        .replace("@CREATE_TIME@", time.strftime("%Y%m%d-%H:%M:%S"))
    )

    DIST.mkdir(exist_ok=True)
    out = DIST / f"NetAssign-{version}-noarch.spk"
    with tarfile.open(out, mode="w", format=tarfile.GNU_FORMAT) as spk:
        _add_bytes(spk, "INFO", info.encode())
        _add_bytes(spk, "package.tgz", package_tgz)
        _add_dir(spk, "conf")
        _add_bytes(spk, "conf/privilege", _text(PKG_DIR / "conf" / "privilege"))
        _add_dir(spk, "scripts")
        _add_bytes(spk, "scripts/start-stop-status", _text(PKG_DIR / "scripts" / "start-stop-status"), 0o755)
        noop = _text(PKG_DIR / "scripts" / "noop")
        for hook in LIFECYCLE_HOOKS:
            _add_bytes(spk, f"scripts/{hook}", noop, 0o755)
        _add_bytes(spk, "PACKAGE_ICON.PNG", icons[64])
        _add_bytes(spk, "PACKAGE_ICON_256.PNG", icons[256])
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument(
        "--preview-icons",
        action="store_true",
        help="also write the app icons to src/ui/images/ (gitignored) for local preview",
    )
    args = parser.parse_args()
    if args.preview_icons:
        images = UI_DIR / "images"
        images.mkdir(exist_ok=True)
        for size in APP_ICON_SIZES:
            (images / f"netassign_{size}.png").write_bytes(render_icon(size))
    out = build(args.version)
    print(f"built {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
