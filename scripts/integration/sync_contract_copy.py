#!/usr/bin/env python3
"""Copy a canonical contract folder of this repo (contracts/community-ingest/ by default, or contracts/my-reports/)
into another repository and verify MANIFEST.sha256.

    python3 scripts/integration/sync_contract_copy.py --to <repo root> [--contract my-reports] [--check]
    python3 scripts/integration/sync_contract_copy.py --manifest my-reports   # rewrite the canonical MANIFEST.sha256

--check only verifies an existing copy (used by tests / CI in the consuming repository). Files are copied
byte-for-byte; the copy must never be edited in place (edit the canonical folder, re-run this script).
"""
import argparse
import hashlib
import shutil
import sys
from pathlib import Path

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
NAMES = ("community-ingest", "my-reports")


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
    ap.add_argument("--to")
    ap.add_argument("--contract", choices=NAMES, default="community-ingest")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--manifest", choices=NAMES, help="rewrite MANIFEST.sha256 of this canonical folder and exit")
    args = ap.parse_args()
    if args.manifest:
        folder = CONTRACTS / args.manifest
        files = sorted(p for p in folder.rglob("*") if p.is_file() and p.name != "MANIFEST.sha256")
        lines = [f"{hashlib.sha256(p.read_bytes()).hexdigest()}  ./{p.relative_to(folder).as_posix()}" for p in files]
        (folder / "MANIFEST.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"manifest written: {folder / 'MANIFEST.sha256'} ({len(lines)} files)")
        return 0
    if not args.to:
        ap.error("--to is required")
    SRC = CONTRACTS / args.contract
    dst = Path(args.to).resolve() / "contracts" / args.contract
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
