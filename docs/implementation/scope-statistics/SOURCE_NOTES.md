# 확인 근거와 참고 자료

이 문서는 코드 읽기 결과와 구현 API 참고자료를 기록한 것이다. 운영 배포·브라우저 실행·DB 자료 완전성을 확인했다는 뜻은 아니다.

## 이전 세트의 실제 통합

기존 대화 첨부 `OPUS_IMPLEMENTATION_PROMPT.md` 493줄, `ACCEPTANCE_TESTS.md` 159줄을 전체 읽고 통합했다. 기존 S01~S08의 기능 요구와 모든 기존 SC/PI/NV/PG/PV/MS/CH 테스트를 유지했다. 구 S09(파일 연결)·S10(순서/인수)은 새 S11·S12로 옮기고 새 S09(월별 복수 비율)·S10(조회 상태)을 앞에 배치했다.

## 이번 재확인 코드

저장소: Fentanest/safetyreport-community-map
고정 참조: 67e35c60ed7928aff21d8bcd5df592c4cccd1b1f
실행자는 최신 코드를 다시 읽는다. 아래 참조로 reset/checkout하지 않는다.

### C1 — 월별 단일 비율

TrendCard.tsx는 `RateMetric=accept|partial|reject|fine` 및 단일 `rate` 상태와 select를 사용한다. `monthRate()`는 월의 actual numerator/denominator를 사용하고 분모0을 null로 돌려준다. 내 비교는 `mine_outcomes` 유무로 지원 여부를 판정하는 경로가 있어 fine만 지원 가능한 경우를 분리하도록 지시했다. 비율 표의 내 지표도 현재 한 개만 표시한다.

```text
https://github.com/Fentanest/safetyreport-community-map/blob/67e35c60ed7928aff21d8bcd5df592c4cccd1b1f/src/components/TrendCard.tsx
```

### C2 — 대시보드 조회 상태

useDashboardData는 RefreshController를 관찰한다. RefreshController에는 requested/displayed, refreshing, scheduled, pausedUntil, generation, access/error 상태와 debounce/abort/409/429 처리가 있다. refreshing은 예약 대기를 포함하므로 실제 fetching만 뜻하는 것이 아니다. 이를 보존하며 UI 표시와 독립 resource 상태를 통합하도록 지시했다.

```text
https://github.com/Fentanest/safetyreport-community-map/blob/67e35c60ed7928aff21d8bcd5df592c4cccd1b1f/src/hooks/useDashboardData.ts
https://github.com/Fentanest/safetyreport-community-map/blob/67e35c60ed7928aff21d8bcd5df592c4cccd1b1f/src/data/refreshController.ts
```

### C3 — 차트 갱신·테마

lib/charts.ts는 init/dispose 수명주기를 setOption 갱신과 분리하고 ResizeObserver·theme 토큰을 사용한다. 현재 setOption은 notMerge:true이다. 새 시리즈/표현을 공통 hook에서 처리하되 지표 체크마다 인스턴스를 재생성하지 않도록 했다.

```text
https://github.com/Fentanest/safetyreport-community-map/blob/67e35c60ed7928aff21d8bcd5df592c4cccd1b1f/src/lib/charts.ts
```

## 공식 구현 문서

아래는 2026-09-29 확인한 공식 페이지다. 문서를 그대로 베끼는 요구가 아니라 현재 설치 버전의 지원 동작을 확인하기 위한 참고다.

- ECharts Legend: 범례별 show/hide 및 selected 설정. 이번 월별 차트의 checkbox와 별개로 숨김 상태가 갈라지지 않게 설계한다.
- ECharts Dynamic Data: setOption 갱신, showLoading/hideLoading. 최신 snapshot 유지형 UI에서는 큰 overlay 사용 여부를 검토한다.
- WAI-ARIA 1.2 aria-busy: 실제 업데이트 중 상태 전달.
- W3C ARIA22 role=status: focus 이동 없이 상태 변화를 전달.

```text
https://echarts.apache.org/handbook/en/concepts/legend/
https://echarts.apache.org/handbook/en/how-to/data/dynamic-data/
https://www.w3.org/TR/wai-aria-1.2/#aria-busy
https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22
```

## 첨부 이미지

`references/`는 사용자가 제공한 현재 화면의 복사본이다. 새 구현의 검수 증거가 아니다. 개인 이름·주소가 보일 수 있으므로 검수 fixture·테스트 배포 산출물에 자동 포함하거나 공개 저장소에 무조건 커밋하지 않는다. 로컬 참고 문서로 사용하고 공개 artifact scan 대상 배포 경로와 분리한다.
