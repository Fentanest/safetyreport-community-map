"""MANIFEST.sha256 검사: 계약 폴더의 파일 집합과 sha256 이 MANIFEST 와 정확히 같은지 본다(저장소를 바꾸지 않는다).

  python3 scripts/check_contract_manifests.py            # 아래 DIRS 전부
  python3 scripts/check_contract_manifests.py --write D  # D 의 MANIFEST 를 다시 쓴다(계약을 바꾼 뒤)

community-ingest-v2 는 생성기 재현까지 보는 scripts/raw-ingest/check_contract.py 가 따로 검사한다.
"""
import argparse
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRS = ['contracts/parser', 'contracts/app-announcements']


def listing(base: Path) -> dict[str, str]:
    return {str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(base.rglob('*')) if p.is_file() and p.name != 'MANIFEST.sha256'}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='append', default=[])
    args = ap.parse_args()
    for d in args.write:
        base = ROOT / d
        (base / 'MANIFEST.sha256').write_text(''.join(f'{h}  {n}\n' for n, h in listing(base).items()))
        print(f'wrote {d}/MANIFEST.sha256')
    if args.write:
        return 0
    failures = []
    for d in DIRS:
        base = ROOT / d
        man = base / 'MANIFEST.sha256'
        if not man.is_file():
            failures.append(f'{d}: MANIFEST.sha256 없음')
            continue
        want = {}
        for line in man.read_text().splitlines():
            h, sep, n = line.partition('  ')
            if not sep or len(h) != 64:
                failures.append(f'{d}: 잘못된 줄 {line!r}')
                continue
            want[n] = h
        have = listing(base)
        if set(want) != set(have):
            failures.append(f'{d}: 파일 집합 다름 missing={sorted(set(have) - set(want))} extra={sorted(set(want) - set(have))}')
        for n, h in want.items():
            if have.get(n) != h:
                failures.append(f'{d}: 해시 다름 {n}')
    for f in failures:
        print(f'FAIL: {f}', file=sys.stderr)
    if failures:
        return 1
    print(f'PASS: {len(DIRS)} contract manifests')
    return 0


if __name__ == '__main__':
    sys.exit(main())
