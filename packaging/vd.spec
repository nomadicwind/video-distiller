# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Windows onedir build of VideoDistiller (M13).

Run from the repo root as:

    pyinstaller packaging/vd.spec --distpath <dist-dir>

All paths below are computed from ``SPECPATH`` (the folder this spec file
lives in, injected by PyInstaller into the spec's exec globals) rather than
relied upon as relative strings, so the build is correct regardless of the
caller's current working directory.
"""
from pathlib import Path

SPEC_DIR = Path(SPECPATH).resolve()  # noqa: F821 - injected by PyInstaller
REPO_ROOT = SPEC_DIR.parent
BACKEND_SRC = REPO_ROOT / "backend" / "src"
ENTRY_SCRIPT = BACKEND_SRC / "vd" / "serve.py"
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

# uvicorn[standard]'s classic hidden-import set (its protocol/loop backends
# are selected dynamically and PyInstaller's static analysis misses them),
# plus yt_dlp (lazily imported only in the frozen branch of ingest.py, so
# static analysis never sees the import) and anthropic (used by agent.py).
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "yt_dlp",
    "anthropic",
]

a = Analysis(
    [str(ENTRY_SCRIPT)],
    pathex=[str(BACKEND_SRC)],
    binaries=[],
    datas=[(str(FRONTEND_DIST), "webdist")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="VideoDistiller",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # keep the console visible: it's the app's only log output,
                   # and 使用说明.txt tells users that closing the window stops it.
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="VideoDistiller",
)
