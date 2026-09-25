# 저장소·참고자료 확인 기록
확인일 2026-09-24. 이 기록 이후 변경 가능하므로 Sol 착수 시 HEAD와 diff를 재확인한다.

## 현재 community-map v1
확인 tree/commit: `ff63cfd0ac49da346d96bc22a39e7157254e336f`.
README + docs 8개 + `supabase/migrations/202608150001_initial_schema.sql` 중심의 설계 레포였다.
초기 입력은 year × category × location의 aggregate이며 manager_counts는 비공개,
차량번호/신고일시/완료일시를 받지 않는다. phone OTP, 사용자당 active snapshot 1개,
public_map_points의 all 조합 사전 집계가 기본이었다.

## 새 요구와의 차이
| 요구 | v1만으로 가능? | 조치 |
|---|---|---|
| 카카오 지도·기존 지점 총계 | 일부 가능 | 공개 DTO 어댑터 |
| 임의 날짜 범위·월별 추이 | 불가: 연도만 있음 | report_date·completed_date 또는 그 joint daily cube 필요 |
| 담당자별 수용/일부수용/불수용 | 불가: 이름별 수만 있음 | 기관+담당자+상태 교차집계 필요 |
| 처분 완료월별 증감 | 불가 | 실제 완료일 기반 처분 사실/집계 필요 |
| 선택 지역·기간 차량 TOP5 | 불가: 차량 자체 미수집 | private canonical vehicle + 날짜/공간과 결합된 사실 필요 |
| 전화번호 없는 Google 기여자 | 인증부 변경 필요 | UUID 관계는 유지 |

**원천에 없는 값을 추정하거나 비례 배분하지 않는다.** latest DB에 필드가 생겼다는 가정은 실제 스키마/샘플 검사로 확인한다.
upstream 구현 자체는 이 패키지 대상이 아니며 필요한 계약과 gap 문서를 납품한다.
필드가 부족해도 fixture UI·stat tests는 진행한다. 운영 capability는 unsupported/missing으로 표시한다.

## WorklazyTools 호출 근거
`docs/agent-dispatch-runbook.md`, blob `46253121e8db79c0a57897764b6bfc4cea39348d`의 Muse/OpenCode 절을 확인했다.
`docs/agent-ops-config.json`, blob `a3552a67f70a48f65ee00e84c6d36130b50c3434`는 Sol을 `gpt-6-sol`,
`muse_runtime_id`를 null로 둔다. 따라서 실제 Muse provider/model ID는 여기서 확정할 수 없으며
호스트의 `opencode models`와 현재 구독 연결로 확인해야 한다. 불명확한 ID를 박아 넣지 않았다.
stdin 닫기, 같은 worktree·session 재개, 실제 결과 회수, global permission 우회 금지를 이식한다.
WorklazyTools의 Claude/Jev/Gemini 호출 전체를 이 프로젝트에 추가하지 않는다.

## 디자인 근거
이전 Library의 `design tokens.png`, `UI COMPONENT KIT.png`, `pc dark.png`, `pc light.png`,
`mobile dark.png`, `guide(1).png`, `board(1).png`, `LOGO.png`를 확인·동봉했다.
brand primary #0D6EFD, dark bg #0B1220, navy surfaces, cyan/blue highlights와 상태 semantic family를 채택했다.
`lib/server_palette.dart` 기존 구현은 Bootstrap 계열(#198754 등)로 색 수치가 일부 다르다.
새 토큰은 사용자 제공 디자인 보드의 색을 기준으로 정리한 **구현용 제안 정본**이며 기존 코드와 동일 값이라고 주장하지 않는다.
원본 보드의 폰트·hex 오탈자·가짜 수치·차량/민원번호는 기능 명세나 공개 데이터가 아니다.
원본 참고 보드(`design/references/`)는 2026-09-26 저장소에서 삭제했다.

## 다크 배색 변경 (2026-09-25)
`safetyreport`의 `dev` 작업트리 `2f20f2e`에서 웹·모바일 공통 B안 딥 다크 팔레트를 확인했다.
위의 2026-09-24 네이비 채택 기록은 이전 결정이다. 현재 community-map은 배경·표면·테두리·글자와
강조 글자/채움 색을 `contracts/dark-palette.json`에 맞춘다. 원본 참고 이미지는 이전 시안으로 보존한다.
