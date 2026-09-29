# 선택 범위 상세·맞춤 통계 — 완본 v2

버전: `scope-statistics-2026-09-29.2`
대상: `Fentanest/safetyreport-community-map`
담당: Opus

**이 패키지 하나만 전달하면 된다.** 이전 scope-statistics zip이나 추가 지시 메모를 별도로 합칠 필요가 없다. 기존 기능 확장 전체에 월별 비율 복수 선택과 실제 조회중 표시를 통합했다.

## 전달 순서

1. 패키지 파일을 작업 레포의 `docs/implementation/scope-statistics/`에 배치한다. 기존 .1 문서가 있다면 사용자/다른 에이전트 변경을 확인하고 이 .2로 갱신한다. git reset/clean은 하지 않는다.
2. `START_PROMPT.md`의 코드블록을 Opus에게 전달한다.
3. Opus는 `OPUS_IMPLEMENTATION_PROMPT.md`와 `ACCEPTANCE_TESTS.md` 전체를 읽고 구현한다. 이미 구현된 부분은 회귀 확인 후 유지한다.

채팅에 zip만 첨부하는 환경에서는 압축 내용의 두 핵심 문서를 읽도록 지시해도 된다. 문서 경로는 실제 배치 위치에 맞춘다.

## 구성

| 파일 | 용도 |
|---|---|
| OPUS_IMPLEMENTATION_PROMPT.md | S01~S12 통합 구현 지시서, 이전 요구 전체 포함 |
| ACCEPTANCE_TESTS.md | 기존+신규+통합 인수 테스트, 모두 미실행 계획 |
| START_PROMPT.md | 복사해 전달할 시작 메시지 |
| REQUIREMENTS_MATRIX.md | 사용자 요구→구현 절→테스트 연결 |
| CHANGELOG.md | v1→v2 통합 내용 |
| SOURCE_NOTES.md | 기존 문서·재확인 코드·공식 문서 근거 |
| fixtures/monthly-rates.example.json | 월별 네 비율/내 비교/null/0의 합성 계산 oracle |
| references/*.png | 사용자가 올린 수정 전 참고 화면 |
| PACKAGE_CHECKS.md | 문서/패키지 자체 검증. 앱 테스트 결과가 아님 |
| MANIFEST.sha256 | 패키지 파일 무결성 확인용 |

## 분명한 경계

새로운 화면 시안이나 운영 앱은 포함하지 않는다. 테스트 입력·참고 이미지는 공개 배포 경로에 복사하지 않는다. 특히 참고 화면의 주소·이름은 실제 화면 자료일 수 있으므로 공개 저장소 커밋 여부를 검토한다. 현재 인증·공개·마스킹 정책은 유지한다.

완료 보고는 S01~S12별 실제 구현/검수/남은 운영적용을 구분한다. 문서를 읽거나 합성 fixture를 만들었다는 이유로 운영 성공이라고 보고하지 않는다.
