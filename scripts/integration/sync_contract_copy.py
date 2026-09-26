#!/usr/bin/env python3
"""Copy contracts/community-ingest/ (canonical, this repo) into another repository and verify MANIFEST.sha256.

    python3 scripts/integration/sync_contract_copy.py --to <repo root> [--check]

--check only verifies an existing copy (used by tests / CI in the consuming repository). Files are copied
byte-for-byte; the copy must never be edited in place (edit the canonical folder, re-run this script).
"""
import argparse
import hashlib
import shutil
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "contracts" / "community-ingest"


def verify(folder: Path) -> list[str]:
    problems = []
    manifest = folder / "MANIFEST.sha256"
    if not manifest.is_file():
        return [f"missing {manifest}"]
    listed = set()
    for line in manifest.read_text(encoding="utf-8").splitlines():
        digest, _, rel = line.partition("  ")
        rel = rel.removeprefix("./")
        listed.add(rel)
        f = folder / rel
        if not f.is_file():
            problems.append(f"missing {rel}")
        elif hashlib.sha256(f.read_bytes()).hexdigest() != digest:
            problems.append(f"hash mismatch {rel}")
    extra = {str(p.relative_to(folder)) for p in folder.rglob("*") if p.is_file()} - listed - {"MANIFEST.sha256"}
    problems += [f"unlisted {e}" for e in sorted(extra)]
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    dst = Path(args.to).resolve() / "contracts" / "community-ingest"
    if not args.check:
        problems = verify(SRC)
        if problems:
            print("canonical contract folder is inconsistent:", *problems, sep="\n  ")
            return 1
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(SRC, dst)
    problems = verify(dst)
    if problems:
        print("contract copy check FAILED:", *problems, sep="\n  ")
        return 1
    print(f"contract copy ok: {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
