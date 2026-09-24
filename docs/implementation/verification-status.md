# 구현 검증 상태 · 2026-09-24

범위는 로컬 구현과 명시적 합성 fixture다. `PASS_LOCAL`은 운영 승인이나 실데이터 검증을 뜻하지 않는다. `BLOCKED`는 필요한 운영 키·원천·배포가 없어서 통과 판정할 수 없다는 뜻이다. Muse M3-F가 재검수한 제품 코드는 `56c7a3ad15356d6e9e4e52618c36275e7e9f2d39`에 고정됐고, 증거는 `docs/reviews/M3-final.md`에 있다. 이후 커밋은 검수 보고서와 상태 문서만 더한다.

| acceptance ID | 상태 | 확인 근거와 남은 경계 |
|---|---|---|
| DATA01 | PASS_LOCAL | v1 원천 결손을 `docs/upstream-gaps.md`에 명시, v2 `ready=false`, demo 임의 범위는 `null` |
| DATA02–04 | PASS_LOCAL | 신고일/완료일 월 분리, D/unknown, 0분모·신규 비교를 `aggregate.test.ts`로 확인 |
| DATA05 | PASS_LOCAL | KST 연말·윤일·동일 길이 이전 기간 함수 테스트. 운영 원천의 부분월 대조는 BLOCKED |
| DATA06–08 | PASS_LOCAL | 전체 기간 TOP5 재계산, 접두어 보존 후 마스킹, snapshot 중복제거 테스트 |
| DATA09–10 | PASS_LOCAL | 교차 원천 없는 v1에 대한 추정 없음, 완료일 결측 대체 없음 |
| PRIV01 | PASS_LOCAL | 정확 좌표·전체 성명·1건 반환 단위 테스트와 UI fixture. 실데이터 공개 승인 절차는 별도 |
| PRIV02–04 | PASS_LOCAL | strict public schema, raw 필드 거부, 배포 산출물 스캔, 마스킹 충돌 독립 행 테스트 |
| SEC01 | BLOCKED | 로컬 PostgreSQL 16에서 anon/authenticated 권한 차단과 service_role RPC를 확인. CI 전용 권한 및 운영 Supabase 실제 grant 검사는 미실행 |
| SEC02 | PASS_LOCAL | `VITE_DATA_MODE=live npm run build` 후 `npm run scan`; 실제 Pages artifact는 미생성 |
| SEC03 | BLOCKED | allowlist/429/DB rate RPC 단위·로컬 검증. 실제 Edge gateway, 공격성 부하·timeout 검증은 미실행 |
| SEC04 | PASS_LOCAL | 악성 기관명·담당자명·주소를 React 서버 렌더에 넣어 HTML escape 확인. 운영 응답의 브라우저 공격성 검사는 미실행 |
| SEC05 | BLOCKED | 로컬 DB 철회 시 version 변경·ready=false 및 클라이언트 version 일치 검사. 운영 API/정적 캐시 긴급 재생성은 미실행 |
| UI01–02 | PASS_LOCAL | M3 8개 화면/테마 셀, M3-F 4개 회귀 셀과 390px overflow 0 확인 |
| UI03 | BLOCKED | 실제 Kakao JS 키·등록 도메인 없음. mock SDK 경로는 실지도 통과로 계산하지 않음 |
| UI04–05 | PASS_LOCAL | M3/M3-F에서 1건·0건·미지원, 선택 지점과 전체 수치, 범위·분모 표시를 실제 Chrome으로 확인 |
| UI06–08 | PASS_LOCAL | M3에서 1440/2560·브리핑/Esc·light·정렬·표 대안 확인. 스크린리더 전체 탐색과 reduced-motion 실측은 NOT_RUN |
| UI09 | BLOCKED | 실패 카드가 attribution 영역을 가리지 않는 것은 확인. 실제 Kakao 로고·축척·dark 지도 동작은 키가 없어 미검증 |
| PERF01 | PASS_LOCAL | 10,000개 원 지점을 1,000개 이하 표시 노드로 묶고 원건수/지점수 보존하는 테스트. 실제 패닝 성능은 BLOCKED |
| PERF02 | BLOCKED | 초기 JS gzip 약 115 KB, 차트 지연 로드. 운영 장시간 task·메모리 측정은 미실행 |
| REL01 | BLOCKED | M3-F가 로컬 `/safetyreport-community-map/` 정적 호스팅의 assets/파비콘·새로고침·Back을 통과. 실제 GitHub Pages 배포 smoke는 미실행 |
| REL02 | PASS_LOCAL | live 실패 시 demo 자동 대체 없음, sample 배지 분기. 실제 live endpoint 검사는 BLOCKED |
| REL03 | PASS_LOCAL | M0/M1/M2/M3/M3-F Muse 호출, M3-F 세션 export에서 `opencode-go/muse-spark-1.3-contributor` 확인. 제품 코드 고정 커밋과 보고서 commit은 문서 추가로 구분 |
| REL04 | PASS_LOCAL | 운영 DB·push·배포 없음. 로컬 migration 제안과 검증만 수행 |

아직 구현하지 못한 명세 항목: 지역 A/B 비교 슬롯, 최근 증가 지점 목록, `map`의 별도 zoom/resolution·상태 조건, 기관 전체 페이지 탐색과 서버 정렬, 운영 취소 요청의 정적 캐시 긴급 재발행 자동화. 현재 화면이 이 기능을 제공한다고 표시하지 않으며 `docs/public-api-contract.md`에 계약 차이를 적었다.

재현 명령: `npm test` (23개), `python3 -m unittest discover -s tests/product -p 'test_*.py'` (3개), `python3 -m unittest discover -s tests/blueprint` (27개), `VITE_DATA_MODE=live npm run build`, `npm run scan`. 전체 실행 결과는 최종 작업 기록에 남긴다.
