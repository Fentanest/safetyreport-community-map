# 파서 워커는 별도 레포로 옮겼습니다

원본(JSON) 파서 워커(`community-parser`)의 코드·시험·Dockerfile 은 비공개 레포
`Fentanest/safetyreport-community-parser` 로 옮겼다(2026-10-22, 이 디렉터리 이력째 `git subtree split`).
이 공개 레포의 과거 커밋에는 옮기기 전 코드가 그대로 남아 있다.

지도 레포에 남는 것:
- DB 스키마·투영 함수: `supabase/migrations/`(`community_report_raw`·`community_parse_queue`·`finish_raw_parse` 등).
- 파서와 지도가 함께 지키는 계약: `contracts/parser/`(`parsed_columns.json`, `derived-v1.json`, `parser-vectors.json`)와
  처리기관-지역 목록 `shared/agency-region-registry/`. 파서 레포는 빌드·CI 때 `MAP_REF`(파서 레포 `deploy/map-ref`)
  커밋의 이 파일들을 내려받아 지도 MANIFEST 해시와 비교한다.
- 파서 코드가 있어야 하는 지도 쪽 작업(계약 벡터 재생성, 워커를 띄우는 통합 시험)은 환경변수 `PARSER_REPO`
  (파서 레포 checkout 경로)를 받는다. 없으면 이유를 출력하고 건너뛴다.

처리기관 목록이나 `contracts/parser/` 를 바꾸면 파서 레포의 `deploy/map-ref` 를 그 지도 커밋으로 올리고 이미지를 다시 빌드한다.
