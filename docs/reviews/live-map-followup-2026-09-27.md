# 운영 지도 로그인·표시 후속 점검 · 2026-09-27

## 사용자 로그인으로 재현한 통계 오류

사용자가 별도 Chrome 창에서 직접 카카오 로그인했다. 세션 값·인증 코드·계정 식별자는 기록하지 않았다.
운영 지도에서 `public-analytics/meta`는 Bearer 헤더를 받고도 503 `AGGREGATE_NOT_READY`를 반환했다.
이 오류 코드는 handler의 예상하지 못한 저장소 오류도 같은 503으로 감싼 결과다.
원격 migration 이력에는 `202609280700_analytics_viewer.sql`이 없었고, 이미 배포한 Edge 함수는
그 migration의 `internal_analytics_viewer` RPC를 호출하고 있었다.

`PROJECT_RULES.md`에 따라 사용자의 운영 DB 변경 승인을 별도로 받았다.
합성 배포 workdir의 `db push --dry-run --skip-vault`가 위 migration **한 건만** 제시함을 확인한 뒤 적용했다.
새 함수는 검증된 사용자·세션의 카카오 신원, 활성 공유 동의와 본인 지도 신고 존재 여부만 읽는다.
같은 PC 세션에서 새로고침한 결과 `meta`·`dashboard`·`entities`가 Bearer 헤더와 함께 모두 200,
지도 대시보드 표시, pageerror·console error 0이었다. 익명 `meta`는 계속 401이다.

## 삼성 인터넷 카카오 복귀 주소

사용자 관측: 지도 도메인에서 로그인한 뒤 모바일에서 `localhost:3000`으로 복귀했다.
운영 Auth 구성에는 지도 와일드카드 URL만 있고 정확한 지도 루트 URL은 없었으며
기본 Site URL이 `http://localhost:3000`이었다. 프런트는 현재 지도 주소를 `redirectTo`로 보낸다.
사용자가 운영 Auth 설정 변경을 승인한 뒤 기존 앱·인증 사이트 콜백은 유지하며
`https://safemap.worklazy.net/`을 허용 목록에 추가하고 Site URL을 같은 주소로 바꿨다.
`config diff`로 **이 두 항목만** 업데이트됨을 확인했고 적용 뒤 차이가 없음을 다시 확인했다.
삼성 인터넷 유사 UA의 새 브라우저에서 Supabase authorize 요청의 `redirect_to`가 정확한 지도 루트였고
카카오 로그인 페이지로 이동했다. 실제 삼성 인터넷에서 로그인 완료 후 복귀는 사용자 재시험 대기 중이다.

## 로그인 후 지도 문제 재현과 수정 후보

- 클러스터: 운영 지점 수가 서버의 1,000개 묶기 기준보다 적어 정확한 지점 마커가 그대로 모두 표시됐다.
  완료일로만 현재 기간에 들어온 지점은 신고일 건수 0인데도 신고 수 지도에서 마커를 그렸다.
  지도 화면 표시만 클러스터링하고 지표의 날짜 기준에 맞는 양수 마커만 보여 주는 UI 후보를 구현한다.
- 화면 범위: 전국 축척에서 Kakao viewport가 경도 132도보다 동쪽까지 확장됐다. 서버와 공유 URL parser가
  국내 좌표 봉투만 받으므로 `보이는 지역만 보기`의 `dashboard`가 400 `INVALID_QUERY`였다.
  실제 지도 화면 좌표를 허용하는 지리 경계 검사로 수정하고 재현 viewport를 회귀 테스트에 넣었다.
- 지역 복귀: 기존 버튼은 지도보다 아래에 있는 지역 목록에만 나타난다. 지도 조작 자리에도 상위 지역으로
  돌아가는 버튼을 놓는 UI 후보를 구현한다.

## 수정 후보 검증

- 통합 commit: `8ccae6b`(화면 경계 parser), `7907c53`(Muse 지도 UI). Muse 세션 export에서 실제
  `opencode-go/muse-spark-1.3-contributor` 모델을 확인했다. 합성 fixture 브라우저 검수는
  `docs/reviews/muse-map-cluster-controls.md`에 있다.
- Sol이 완료 지표 안내문과 완료일 전용 지점 회귀 테스트를 동기화했다. `npm test`는
  216 passed / 28 skipped, `VITE_DATA_MODE=live` 빌드와 공개 산출물 스캔은 통과했다.
- 실제 운영 도메인에 로컬 빌드 자산을 임시 제공하여 로그인된 PC의 진짜 Kakao SDK로 확인했다.
  전국에서 신고 지점은 소수의 합계 원으로 표시되었고, 큰 묶음을 클릭하면 해당 지역으로 확대되어
  더 작은 묶음과 개별 지점으로 분리됐다. `0` 원은 수정 후보 화면에 없었고 dashboard는 200,
  콘솔 및 pageerror는 0이었다. 이 브라우저의 화면 캡처에는 공유자 전용 통계가 있으므로
  공개 저장소에 넣지 않았다.
- 지도 상단 복귀 버튼은 fixture 브라우저에서 시군구→시도→전국, 키보드 조작과 모바일 폭을 검증했다.
  운영 도메인의 수정 후보에서는 브라우저 세션 종료로 지역 복귀 재검증을 마치지 못했다.
- `보이는 지역만 보기`는 기존 운영 Edge가 여전히 이전 bbox parser를 쓰므로 운영 end-to-end는
  새 Edge 배포 후 다시 검사해야 한다. 회귀 테스트에는 실제 운영 Kakao viewport 좌표를 사용했다.

지도 수정 후보의 Git push, Edge 배포, Pages 배포는 별도 승인 전이며 운영에는 아직 반영되지 않았다.
