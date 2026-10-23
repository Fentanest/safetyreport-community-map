"""Verify the v2 contract without changing any repository.

1. MANIFEST.sha256 lists exactly the files in contracts/community-ingest-v2 and every digest matches.
2. Re-running generate_contract.py into a temporary directory reproduces every generated file byte-for-byte
   (schemas and vectors cannot drift from the generator, e.g. by hand edits).
3. With --copies, each copy (pc/mobile) is byte-identical, file set included.
Uses explicit checks (not assert, which python -O strips) and exits 1 listing every failure.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'contracts/community-ingest-v2'
failures: list[str] = []


def check(ok: bool, message: str) -> None:
    if not ok:
        failures.append(message)


def files(directory: Path) -> set[str]:
    return {str(f.relative_to(directory)) for f in directory.rglob('*') if f.is_file()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--copies', nargs='*', type=Path, default=[])
    args = parser.parse_args()

    rows = [line for line in (BASE / 'MANIFEST.sha256').read_text().splitlines() if line]
    entries: dict[str, str] = {}
    for line in rows:
        digest, sep, name = line.partition('  ')
        check(bool(sep) and len(digest) == 64, f'manifest line malformed: {line!r}')
        if sep:
            entries[name] = digest
    check(set(entries) == files(BASE) - {'MANIFEST.sha256'},
          f'manifest file set: missing={sorted(files(BASE) - {"MANIFEST.sha256"} - set(entries))} '
          f'extra={sorted(set(entries) - files(BASE))}')
    for name, digest in entries.items():
        path = BASE / name
        check(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest, f'digest mismatch: {name}')

    # Both compatibility forms must stay in the shared hash vectors, with explicit UTF-8 evidence.
    wire = json.loads((BASE / 'vectors/wire.json').read_text())
    cases = wire.get('supplement_hash_cases', [])
    check({c['name'] for c in cases} == {'newline', 'tab', 'crlf', 'u0001'}, 'control-character hash cases missing')
    for case in [*cases, *wire.get('canonical_hash_cases', [])]:
        for form in ('server', 'literal'):
            vector = case.get(form, {})
            encoded = vector.get('canonical', '').encode('utf-8')
            check(encoded.hex() == vector.get('utf8_hex'), f'{case["name"]}/{form}: UTF-8 mismatch')
            check(hashlib.sha256(encoded).hexdigest() == vector.get('sha256'), f'{case["name"]}/{form}: hash mismatch')
        check(case.get('server', {}).get('sha256') != case.get('literal', {}).get('sha256'),
              f'{case["name"]}: forms must differ for controls')

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        run = subprocess.run([sys.executable, str(ROOT / 'scripts/raw-ingest/generate_contract.py'), '--out', str(out)],
                             capture_output=True, text=True)
        check(run.returncode == 0, f'generator failed: {run.stderr.strip()[-500:]}')
        generated = files(out) - {'MANIFEST.sha256'}
        check(bool(generated), 'generator produced no files')
        for name in sorted(generated):
            committed = BASE / name
            check(committed.is_file() and committed.read_bytes() == (out / name).read_bytes(),
                  f'generated file drift (re-run generate_contract.py): {name}')

    for repo in args.copies:
        copy = repo / 'contracts/community-ingest-v2'
        check(copy.is_dir(), f'copy missing: {copy}')
        if not copy.is_dir():
            continue
        check(files(copy) == set(entries) | {'MANIFEST.sha256'}, f'copy file set: {repo}')
        for name in [*entries, 'MANIFEST.sha256']:
            check((copy / name).is_file() and (copy / name).read_bytes() == (BASE / name).read_bytes(), f'copy drift: {repo}/{name}')

    if failures:
        for message in failures:
            print(f'FAIL: {message}', file=sys.stderr)
        return 1
    print(f'PASS: {len(entries)} contract files; generator output reproduced; {len(args.copies)} copies')
    return 0


if __name__ == '__main__':
    sys.exit(main())
