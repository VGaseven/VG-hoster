#!/usr/bin/env python3
"""Build packages/shopping-list.skill (Claude skill zip) and packages/shopping-list-chatgpt.zip."""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "packages"
SKIP = {"__pycache__", ".amazon-profile", ".pytest_cache"}


def add_tree(z, base, arc_prefix):
    for p in sorted(base.rglob("*")):
        if p.is_file() and not SKIP & set(p.parts) and p.suffix != ".pyc" and p.name != "package.py":
            z.write(p, f"{arc_prefix}/{p.relative_to(base)}")


OUT.mkdir(exist_ok=True)
with zipfile.ZipFile(OUT / "shopping-list.skill", "w", zipfile.ZIP_DEFLATED) as z:
    add_tree(z, ROOT, "shopping-list")
with zipfile.ZipFile(OUT / "shopping-list-chatgpt.zip", "w", zipfile.ZIP_DEFLATED) as z:
    add_tree(z, ROOT.parent / "chatgpt", "chatgpt")
for f in sorted(OUT.iterdir()):
    print(f"{f.name}: {len(zipfile.ZipFile(f).namelist())} files, {f.stat().st_size} bytes")
