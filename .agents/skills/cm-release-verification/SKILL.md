---
name: cm-release-verification
description: Verify contracts, artifacts, Pages subpaths, live integrations and approval boundaries before release.
---
# cm-release-verification

## 읽기
acceptance-matrix.md, deployment.md, privacy-security.md.
## 실행
unit/schema/API/E2E/Muse 결과를 exact commit별 수집. live credentials/domain API smoke와 fixture 검증 분리.
scan_public_dist.py + strict schemas + negative authorization tests. base subpath와 shareURL/refresh 확인.
NOT_RUN/BLOCKED를 남기고 운영배포는 명시 승인 후. 삭제된 data version을rollback하지않는다.
## 출력
release readiness report, test commands/results, Muse evidence, actual live checks, rollback procedure.
## 금지
파일존재/exit0만으로완료, test failure를문서에서지움, 미승인push/migration/deploy.
