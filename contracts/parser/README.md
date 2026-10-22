# 파서 계약 (지도 레포 정본)

파서 워커 코드는 비공개 레포 `Fentanest/safetyreport-community-parser` 에 있다(2026-10-22 분리). DB 스키마와
지도 투영에 속하는 아래 파일의 **정본은 이 공개 폴더**다. 파서 레포는 빌드·CI 때 `deploy/map-ref` 의 지도 커밋에서
이 폴더를 내려받아 이 MANIFEST 해시와 비교한다(처리기관 목록 `shared/agency-region-registry/` 와 같은 방식).

| 파일 | 내용 | 바꾸는 때 |
|---|---|---|
| `parsed_columns.json` | `private.community_report_parsed` 열 이름 순서(`scripts/raw-ingest/build_migration.py` 가 쓴다) | 파싱 열을 바꾸는 migration 과 함께 |
| `derived-v1.json` | v1 관찰값 → 지도 fact 파생값 벡터(Edge `deriveFact` 와 워커가 같은 결과) | 파생 규칙을 바꿀 때 |
| `parser-vectors.json` | PC 파서 벡터 사본(합성 상세 원본). 정본은 PC 레포 `contracts/parser-vectors.json`; 통합 시험이 합성 원본으로 쓴다 | PC 벡터가 바뀌면 같은 바이트로 |

바꾼 뒤: `python3 scripts/check_contract_manifests.py --write contracts/parser` → 파서 레포 `deploy/map-ref` 를 새 지도 커밋으로.
