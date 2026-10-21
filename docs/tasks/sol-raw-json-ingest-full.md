# Sol 작업지시서 · 원본 JSON 전송·서버 파싱·게이트 정리 전체 구현 (2026-10-21)

request_mode: **구현**. 담당: Sol(`gpt-6.1-sol`, 사용자 지정). 검수: Claude Opus 가 네 레포를 한 번에 전체 검수하고 수정한다.
사용자 지시(2026-10-21): "작업 전체를 다 시키고 전체를 검수하자. 프로젝트를 한 번에 건드려야 계획, 의도, 작동이 일치한다."

## 0. 작업 공간
작업 디렉터리 `/home/better0101/projects/raw-json-ingest-ws` 아래 네 worktree 가 있다. 모두 branch `feat/raw-json-ingest`.

| 폴더 | 레포 | 기준 |
|---|---|---|
| `map/` | safetyreport-community-map (지도: Supabase Edge·Postgres·Vite 웹) | main `8997d78` |
| `pc/` | safetyreport (PC/Docker 서버, Python) | dev `1a67d01`, VERSION 3.5.1 |
| `mobile/` | safetyreport-mobile (Flutter) | main `a03d37e0`, 2.4.1+178 |
| `auth/` | safetyreport-community-auth (카카오 인증·동의·계정 API, 같은 Supabase) | main `3e00bc4` |

- **정본 계획**: `map/docs/implementation/raw-json-ingest-20261021/PLAN.md`. 계획과 다르게 해야 하면 PLAN 을 고치고 이유를 보고서에 적는다.
- `map/` 에는 앞서 중단한 실행이 남긴 미완성 변경이 있다(`contracts/community-ingest-v2/`, `scripts/raw-ingest/`, `server/ingest/raw.ts`,
  `server/parser-py/`, `server/ingest/handler.ts`·`supabase/functions/community-ingest/index.ts` 수정). 검토해서 이어 쓰거나 고쳐 쓴다.
- 각 레포의 `AGENTS.md`·`PROJECT_RULES.md`(와 있으면 역할 문서)를 먼저 읽고 따른다. 지도 레포는 `.agents/skills/` 의
  `cm-contract-metrics`, `cm-public-privacy`, `cm-static-supabase`, `cm-release-verification` SKILL.md 도 읽는다.
- **커밋하지 않는다**(샌드박스가 `.git` 쓰기를 막는다). 변경은 각 worktree 에 남겨 두면 검수자가 검수 뒤 커밋한다.
- 네트워크·docker 는 쓸 수 없다. 의존성은 미리 설치했다(map·auth `node_modules`, mobile `pub get`). 로컬 Supabase 스택이 필요한 시험은
  NOT RUN 으로 적고 검수자가 돌린다.

## 1. 금지
- 206/205 등 원격 서버 접속·쓰기, migration 원격 적용, Edge·Pages 배포, 동의 정책 운영 발급, 앱 릴리스·스토어 업로드, push·PR.
- 이 네 worktree 밖 파일 쓰기(원래 checkout `/home/better0101/projects/<레포>` 포함). 호스트·global·Codex 설정 변경.
- `git reset --hard`·`git clean`·force push·브랜치 삭제, 비밀값 출력, broad pkill.
- 실데이터(사용자 신고 원본 등)를 저장소에 넣기. 시험 자료는 합성.
- 문서·주석·커밋 메시지에 해시 기호 바로 뒤 숫자를 붙이는 표기(각 레포 PROJECT_RULES).
- 버전 번호(PC `VERSION`, 모바일 `pubspec.yaml`)는 올리지 않는다. 각 레포 관례대로 CHANGELOG/릴리스 노트에 "미출시" 항목만 쓴다.
  업데이트 안내의 최소 버전 값은 설정으로 두고 기본값을 PC 3.6.0 / 모바일 2.5.0 으로 한다(PLAN 13절 가정).

## 2. 범위 = PLAN.md 10절 P1, P1b, P2, P3, P4, P5 의 코드·시험·문서 전부
P6(운영 적용·릴리스·정책 전환)과 P7(205 실측)은 하지 않는다. 크롬 확장, 모바일 Play 인앱 업데이트는 범위 밖.

### 지도 `map/` (P1, P1b, P2)
- 계약 `contracts/community-ingest-v2/`(README, envelope·event 스키마, 해시 규칙, errors, ACK `parse_pending`, `client_notice`, 벡터+생성
  스크립트, MANIFEST). 원본 정규 직렬화는 PC `core/utils/raw_detail.py`·`contracts/raw-detail-vectors.json` 규칙. v1 계약 파일은 바꾸지 않는다.
- migration(PLAN 4절 전부, 번호는 `202610180400` 뒤): raw·parsed·diffs·queue 표, facts 추가 열, 연결 표 버전 열, `community_parser` 역할,
  철회 시 원본·파싱 행 삭제, 공개 경로 차단, 이벤트 원장 30일 정리(v1 멱등성을 깨지 않는 방식 — 근거를 보고서에).
- 투영 함수 분리(v1·v2 공용), v1 결과 불변 증명(기존 시험 + 동등성 시험). PLAN 5절 교체 규칙.
- Edge v2 경로(플래그 기본 꺼짐, gzip, 한도, 원본 검증, 저장+대기열만), v1·v2 모두 연결 표 버전 기록.
- 파서 워커 `server/parser-py/`(PC `1a67d01` 복사본 + MANIFEST + 일치 검사, DTO 생성부, `resolve.py`, 대기열 처리, diff, 재파싱, Dockerfile·compose 예시).
- P1b 지도 웹: 동의가 outdated 인 사용자가 지도 웹 안내 화면에서 업데이트 안내(PC 3.6.0 / 모바일 2.5.0, 다운로드 링크)를 보게 하고,
  마지막 계약이 v1 인 기여자에게 배너. 실제 브라우저 증거는 검수자가 남긴다(가능하면 Playwright 스크립트를 준비).
- 문서: `docs/data-contract.md`, `database.md`, `privacy-security.md`, `api.md`, `architecture.md`, `client-integration.md`
  (낡은 `transferred` 서술 정정 포함), `implementation/work-ledger.md`.

### auth `auth/` (P3)
- 새 동의문 **초안**(PLAN 8절 내용, 첫머리 업데이트 안내, 철회=소프트 리셋 설명, 3일 유예·재동의 잠금 설명, 공무원 연락처=기관 대표번호
  공공정보). 기존 동의문 버전 체계·파일 관례를 따르고 정책 발급 migration 은 **작성만**(적용 금지). 문구는 사용자 검토 대상으로 표시.
- `community-account` status 에 `ingest: {contracts: [1, 2]}`(서버가 v2 를 받는지; 지도 쪽 플래그와 일관되게 얻는 방법 설계)와
  `client_notice`(3-4절 형태, 설정으로 바꿀 수 있게) 추가. 계약 문서(`account-api.md` 사본들 포함) 갱신. 시험.
- 지도 레포에도 같은 계약 사본이 있으면 같은 바이트로 맞춘다.

### PC `pc/` (P4) · 모바일 `mobile/` (P5) — 같은 규칙, 호출 지점 1:1
- v2 이벤트 생성(원본 문자열·`supplement`·`client_observation`), 전환 조건(7-1: 새 동의 active + status `ingest.contracts` 에 2),
  이벤트 생성 조건 갱신, 업로더 바이트 기준 묶기·gzip, 새 오류 코드 처리, ACK `parse_pending` 표시.
- `raw_backfill` 1회 전송(7-2): 완료 표시·커서·holds, DB 최적화 선행, 누락 채우기 A(목록 전 페이지 대조 → 로컬에 없는 신고 수집)·
  B(원본 없음·손상 재수집, 404/410 `raw_unavailable`)·C(별점·별점사유·사진 촬영시각 보충), 전송, 진행 표시. 모바일은 망 제한 없음.
- `client_notice`·`client_upgrade_required` 표시(PC 웹 배너, 모바일 대화상자+스토어 링크).
- 게이트 정리 7-4 전부: G1~G11, 72시간 유예(마지막 G1 시각을 암호화 동의 이력에, 시계 되돌림=만료), PC 동의 전 DB 주인 기록 제거,
  소프트 리셋 절차·실패 처리·남기는 것/지우는 것, 철회 확인 문구, 모바일 Client 모드, 긴급 정책 시험을 새 규칙으로 교체.
  공통 판정 벡터 `gate-vectors.json` 을 계약 디렉터리에 두고 PC·모바일이 같은 결과로 통과.
- v2 계약 사본은 세 레포(map·pc·mobile) 바이트 동일 + MANIFEST 검사(기존 v1 사본 관례 따름).
- 문서: 각 레포 아키텍처·계약 문서, `docs/plans/` 에 PLAN.md 사본(각 레포 관례), CHANGELOG 미출시 항목.

## 3. 시험 (가능한 것은 모두 실행)
- map: `npm test`(vitest), 해당 deno 시험, `python3 -m unittest` 계열(파서 워커·벡터), `npm run build`, `npm run scan`.
  로컬 Supabase 스택 시험(`tests/integration/*`, `npm run test:sql`)은 docker 가 없어 NOT RUN 으로 적는다.
- pc: `SAFETYREPORT_DATA_DIR=$(mktemp -d) /home/better0101/projects/safetyreport/.venv/bin/python -m unittest discover -s tests -p "test_*.py"`
  (worktree 안에서 실행; `.venv` 는 원래 checkout 것을 절대경로로 쓴다).
- mobile: `~/development/flutter-3.47.5/bin/flutter analyze` 와 `flutter test`(반드시 3.47.5 — PATH 의 flutter 는 3.41.6 이라 쓰지 않는다.
  위젯 시험이 "Runtime stages buffer failed verification" 로 실패하면 `rm -rf build/unit_test_assets` 후 다시).
- auth: `npm test`.
- 실패를 숨기지 않는다. 이번 변경과 무관한 기존 실패는 기준 커밋에서도 실패함을 확인해 따로 적는다.

## 4. 완료 보고
`map/docs/implementation/raw-json-ingest-20261021/SOL-REPORT.md`:
- 레포별 바뀐 파일 묶음과 각 묶음의 목적(PLAN 절 번호로)
- 레포별 실행한 시험 명령·결과 수(통과/실패/건너뜀), NOT RUN 과 이유
- PLAN 과 다르게 한 것과 이유, PLAN 의 결함·모순
- **결정 필요**(PLAN 0절에 없는 제품 결정 — 임의로 정하지 말고 적은 뒤 막히지 않는 부분은 계속 진행)
- 검수자가 꼭 볼 위험 지점, 남은 일
작업이 길어도 중간에 멈추지 말고 범위를 끝까지 진행한다. 끝내지 못한 항목은 보고서에 명시한다.
