# API 정본 안내
공개 읽기 계약은 [public-api-contract.md](public-api-contract.md), 업로더 경계는 [client-integration.md](client-integration.md)다.
기존 Phone OTP 기반 API 문서는 이 패키지 설치 시 backup에 보존된다. 최신 인증 요구는 Google 일반 계정이며
이 공개 UI 구현의 범위는 read API·데이터 projection·Pages client다.
기존 contribute/begin/chunk/finalize 및 동의/철회 semantics는 필요한 adapter와 함께 유지한다.


## 원본 JSON v2 로컬 후보 (2026-10-21)

정본은 [구현 계획](implementation/raw-json-ingest-20261021/PLAN.md), 현 상태·미완료 목록은
[SOL-REPORT](implementation/raw-json-ingest-20261021/SOL-REPORT.md)다. 운영에는 적용하지 않았다.
`contracts/community-ingest-v2`의 원본 문자열·보조 필드·선택 비교 DTO를 검증해 private raw와 queue에 저장한다.
워커가 PC 1a67d01의 고정 Python 파서로 해석한 뒤 공용 SQL 투영 함수로 facts를 갱신한다.
`stored` ACK는 중앙 저장 완료이며 `parse_pending`은 지도 반영 대기다. 파싱 실패 시 이전 fact를 유지한다.
새 raw/parsed/diffs/queue는 public API·화면 캐시·rollup·CSV의 원천이 아니며 anon/authenticated에 권한이 없다.
실제 철회는 raw 삭제와 parsed/diffs/queue cascade를 실행한다. 정책 대체(superseded_policy)는 철회와 구분한다.
v1 원장 payload는 30일 뒤 제거하되 재시도 식별에 필요한 최소 메타·해시·영수증은 유지한다.
capability·notice·차단일은 같은 private 설정 행을 사용하며 v2 기본값은 꺼짐, 차단일은 미정이다.
새 계정 status 계약 사본은 [account-api](account-api.md)다. v1 wire 계약 파일은 유지한다.
