# 공유 동의문 원본 (지도 레포 전용)

필수 신고내용 공유 동의문의 원본이다. **다른 저장소로 복사하지 않는다**(2026-09-27).
PC·모바일 앱은 동의문을 번들에 두지 않고 중앙 `community-account` 의 `policy` 로 받는다(`../community-ingest/account-api.md`).

- 문구를 바꾸면 이 파일을 고치고, auth 저장소에 migration(`private.community_policy_texts` 에 본문 추가 + 정책 행)을 만든 뒤 운영에 적용한다.
- `*.sha256` 은 본문 UTF-8 바이트의 sha256 이다(파일 끝 줄바꿈 유무도 해시에 들어간다).
- 이미 동의가 있는 버전의 문구는 바꾸지 않는다 — 새 버전을 발급한다(auth `202609280600` 가드).
