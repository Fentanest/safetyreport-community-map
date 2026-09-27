# UI 구현 + 검수 보고서 · 지도 클러스터·지표 필터·상단 복귀 버튼
- request_mode: implementation + fixture/browser review / policy: cm-2026-09-24
- worktree: /home/better0101/projects/safetyreport-community-map-muse-map-fix / branch: muse/map-cluster-controls / base: 68300345c4d7a36853acf40a605761349de65831
- commit: (아래 git log 참조) / dirty: 없음(커밋 시점)
- URL: http://127.0.0.1:5173/ (로컬 dev) / data_mode: demo fixture (`VITE_DATA_MODE=demo`, 로그인 없음)
- browser: google-chrome 154.0.8037.57 / playwright-core 1.63.0 (script /tmp/opencode/cm-review/review.mjs)
- model: Sol이 정확한 세션 `ses_f1cba3a77ffe8tJ74L1gkc2m4L`의 sanitized export에서 `opencode-go/muse-spark-1.3-contributor` 확인

## 변경 (소유 범위 내: kakao.ts, MapPanel.tsx, app.css + 신규 UI 테스트 2건)
1. `src/lib/kakao.ts` — far zoom(level ≥ 8) 격자 클러스터링. 버블 숫자는 멤버 표시 건수의 합(SUM), 노드 수가 아님.
   공식 `MarkerClusterer`의 `texts`/`calculator` 콜백은 노드 수만 받으므로 합계 버블이 불가능해(공식 문서 확인),
   문서화된 원시 API(Marker/MarkerImage/LatLng/LatLngBounds/event)만으로 구현. 원좌표 불변, 중심점은 표시용.
   클러스터 클릭 → 멤버 영역으로 zoom(동일 좌표면 중심+2단계 확대). zoom 변경 시 재집계, setPoints/destroy 시 마커 정리.
   수용률 계열 클러스터 색은 멤버 metric 평균.
2. `src/components/MapPanel.tsx` — `displayCount`/`visiblePoints`: 신고 지표는 `report_count>0`만 그리고,
   수용/일부수용/과태료 지표는 `completed_count>0`만 그리고 `완료 N건`으로 표기(API·통계 불변).
   숨긴 곳 수는 목록에 사유와 함께 표시. 마커 타이틀·대체 목록 모두 동일 집합.
   `activeRegion`이 있으면 지도 상단 컨트롤 옆에 복귀 버튼(5자리→`← 시도명`, 2자리→`← 전국`, 지역 목록 컨트롤 유지).
   지도 실패(fallback) 때도 상단 바는 그대로 두어 복귀 버튼을 쓸 수 있게 함.
3. `src/styles/app.css` — `.map-back`(44px)·`.map-top-left`, 390px折返, fallback에서 상단 바를 목록 위 흐름으로(겹침 수정).

## 검수 결과 (fixture, 실지도 아님 — worktree에 Kakao 키 없음)
| viewport | theme | steps | screenshot | console/network | result |
|---|---|---|---|---|---|
| 1920×1080 | dark | 개요 로드·클러스터 안내문구·수용률 전환(완료 N건)·sgg→시도→전국 복귀(클릭+Enter) | docs/reviews/screenshots/muse-map-cluster/1920-overview.png, 1920-mapcard.png, 1920-mapcard-acceptance.png, 1920-mapcard-backbtn.png, result.json | 0 error / 0 failed | PASS |
| 390×844 | dark | 가로스크롤 0px·복귀 버튼 44px·fallback 목록 사용 가능 | docs/reviews/screenshots/muse-map-cluster/390-mapcard-backbtn.png, 390-full.png, result.json | 0 error / 0 failed | PASS |
| unit | — | 합계 버블·정확 좌표 분할·지표 필터·복귀 버튼 마크업(7) + 가짜 SDK 배선(2) | tests/product/mapClusterControls.test.tsx, tests/product/mapClusterWiring.test.tsx | — | PASS 9/9 |

## 발견·조치
| id | severity | 내용 | evidence | owner |
|---|---|---|---|---|
| MC-1 | 중(수정됨) | fallback에서 map-top이 오류 카드와 겹침(기존 apply 버튼도 겹쳐 있었음) → fallback에서 상단 바를 흐름 배치로 변경 | 1920-mapcard-backbtn.png(수정 후) | Muse |
| MC-2 | 경미(수정됨) | 복귀 버튼 aria `서울특별시으로` 조사 오류 → `한 단계 위 지역으로: 서울특별시` | MapPanel.tsx | Muse |
| MC-3 | **Sol 조치 완료** | `tests/product/afMap2PointCount.test.tsx`를 신고 지표 숨김·완료 지표 표시로 갱신. 전체 `npm test` 216 passed / 28 skipped | Sol 통합 테스트 | Sol |
| MC-4 | **Sol 조치 완료** | DataGuide의 완료일 전용 지점 안내를 완료 지표 기준으로 수정 | `src/components/DataGuide.tsx` | Sol |

## 통계·공개 경계
- 합계 보존: 클러스터 합 = 표시 집합 합과 동일(테스트). 0-circle 없음. n=1 유지(단일점은 항상 exact 마커).
- 원좌표·실명·번호·키를 DOM/URL에 추가하지 않음. 공유 URL 변경 없음.

## 최종 판정
- PASS (fixture 범위: 클러스터 순수 로직·배선·필터·복귀 버튼·1920/390 fallback UI, console/network clean)
- NOT_RUN → Sol이 별도 세션에서 수행: 실제 Kakao SDK 렌더(클러스터 버블 합계 숫자 육안·클릭 확대·attribution), 실 로그인 production-origin 테스트.
