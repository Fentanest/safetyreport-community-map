# 아키텍처 · Pages 정적 UI + 제한된 공개 집계 API

## 1. 경계
```text
safetyreport / safetyreport-mobile (이 작업 밖의 업로더)
      → 동의·Google Auth·최신 private contribution facts
                         │
                   Supabase Postgres
                         ├─ private facts / identity / raw vehicle
                         ├─ versioned aggregates / export-only read model
                         └─ public-analytics Edge API (공개 허용 DTO만)
                                      ↑
GitHub Actions → safe export view → initial snapshot → GitHub Pages React UI
                                                     │
                                                     ├─ Kakao JS SDK (공개 JS key)
                                                     └─ public-analytics GET (비밀키 없음)
```

Pages에서 브라우저가 비밀키 없는 공개 API를 호출하는 것은 가능하다. 불가능한 것은 브라우저에 넣은 secret을 숨기는 일이다.
'Pages니까 모든 값을 빌드 시점에만 계산해야 한다'는 앞선 단정을 정정한다.
[근거: S01·S02·S03·S07, docs/sources.md]

## 2. 왜 순수 정적 TOP5가 아닌가
기간 A와 B 각각 6등인 차량이 A+B 합계에서 1등일 수 있다. 월별 상위 5개만 보관하면 범위 TOP5를 복구할 수 없다.
모든 차량·날짜·정확좌표·안정 ID를 정적 JSON으로 배포하면 마스킹해도 쓸데없이 추적 가능한 데이터가 크게 늘어난다.
따라서 **전체 후보는 private에 유지하고, 선택 범위를 서버가 집계한 상위 5개 결과만 반환**한다.
기관·담당자·상태·처분 교차 필터와 distinct contributor도 같은 읽기 모델에서 처리해 수치를 맞춘다.

## 3. 책임
- Postgres: 소유 snapshot 교체, normalized facts, versioned aggregation, 조건에 맞는 정확한 집계.
- Edge: 쿼리 파싱/allowlist, query complexity·limit, response DTO projection, 마스킹 검증, cache·rate limit.
- Actions: 공개 안전한 meta/overview/map preview만 읽어 초기 캐시 생성, missing address 필요 시 제한적 geocode,
  테스트·빌드·artifact scan. raw 차량/사용자 토큰을 Actions로 가져오지 않는다.
- Browser: 페이지 표시·필터·키보드/터치·공개 캐시·map overlays. 사용자가 request를 변조해도 읽기 범위를 벗어나지 못해야 한다.

## 4. 데이터 모드
`demo`: 합성 fixtures 전용; 모든 화면에 예시 배지; production 빌드와 별도.
`snapshot`: 배포 시점 summary·points 캐시. 값의 dataset_version·time range·scope를 표시.
`live`: 같은 공개 API에서 상세 필터 응답. 데이터 실시간 수집을 뜻하지 않는다.
실제 upstream 없음/키 누락 시 demo로 자동 대체하지 말고 live 기능의 준비 상태를 보여준다.

## 5. 일관성
manifest의 `dataset_version`을 한 분석 세션에 고정한다. API 요청에 expected_version을 보내고 불일치하면
409 DATASET_CHANGED로 안내 후 전체 패널을 같은 version으로 재조회한다. 서로 다른 생성본의 KPI와 TOP5 혼합 금지.
API는 계산 시 동일 snapshot/transaction을 사용한다. 단순 max(updated_at)을 data version으로 쓰지 않는다.
사전집계 refresh는 shadow tables/version pointer의 atomic switch; 삭제는 active version에서도 즉시 반영돼야 한다.

## 6. 성능 목표(검증할 예산, 현재 성능 주장 아님)
- 앱 초기 JS gzip 350KiB 이내 목표(지도 SDK 별도), 첫 데이터 gzip 200KiB 목표.
- nationwide marker node 전부 생성 금지. 저줌 aggregate clusters, 고줌 exact points, bbox 단위 lazy data.
- map request는 idle 250~350ms debounce + AbortController + query key/version. 이전 응답이 최신 선택을 덮지 못하게 한다.
- markers window budget 1,000 전후로 시작하고 결과 truncated/resolution 표시. 통계 합계는 렌더링된 마커 수가 아니라 전체 조건 집합.
- charts는 ECharts lazy import, route chunks, ResizeObserver. 사용 후 event listener/overlay clear.
- public API query는 fixed SQL/params, statement timeout, bounded pagination. raw SQL/테이블명 요청 금지.

## 7. 선택적 정적 확장
일별 joint 공개 cube가 정확성·용량·프라이버시 검사를 통과하면 일부 통계를 Worker에서 계산할 수 있다.
그러나 임의 필터의 exact TOP5·distinct contributor를 보장하지 못하면 해당 기능은 API 경로를 유지한다.
정적 경로만 가능하다는 이유로 사용자가 선택할 수 있는 날짜/공간 범위를 몰래 줄이지 않는다.
