# 구현 검증 상태 · 2026-09-24

범위는 로컬 구현과 명시적 합성 fixture다. `PASS_LOCAL`은 운영 승인이나 실데이터 검증을 뜻하지 않는다. `BLOCKED`는 필요한 운영 키·원천·배포가 없어서 통과 판정할 수 없다는 뜻이다. 제품 기준 커밋은 `d05033469ca30480718b6345c8ff05f50b3a0810`; M3 결과는 별도 보고서에 기록한다.

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
| UI01–02 | M3_PENDING | M2의 브라우저 다해상도 검수 후 통합본 M3 검수 진행 중 |
| UI03 | BLOCKED | 실제 Kakao JS 키·등록 도메인 없음. mock SDK 경로는 실지도 통과로 계산하지 않음 |
| UI04–05 | M3_PENDING | 1건·0건·미지원과 범위·분모 코드를 구현, M3 브라우저 재검수 진행 중 |
| UI06–09 | M3_PENDING | M2 브라우저 근거 있음. 통합본의 브리핑·테마·접근성·attribution 재검수 진행 중 |
| PERF01 | PASS_LOCAL | 10,000개 원 지점을 1,000개 이하 표시 노드로 묶고 원건수/지점수 보존하는 테스트. 실제 패닝 성능은 BLOCKED |
| PERF02 | BLOCKED | 초기 JS gzip 약 115 KB, 차트 지연 로드. 운영 장시간 task·메모리 측정은 미실행 |
| REL01 | BLOCKED | Vite 하위 경로 빌드 설정과 URL 상태 구현. 실제 GitHub Pages 배포/새로고침 검사는 미실행 |
| REL02 | PASS_LOCAL | live 실패 시 demo 자동 대체 없음, sample 배지 분기. 실제 live endpoint 검사는 BLOCKED |
| REL03 | M3_PENDING | M0/M1/M2는 실제 Muse 모델/브라우저 근거 보존; 통합본 M3 진행 중 |
| REL04 | PASS_LOCAL | 운영 DB·push·배포 없음. 로컬 migration 제안과 검증만 수행 |

재현 명령: `npm test` (22개), `python3 -m unittest discover -s tests/product -p 'test_*.py'` (3개), `python3 -m unittest discover -s tests/blueprint` (27개), `VITE_DATA_MODE=live npm run build`, `npm run scan`. 전체 실행 결과는 최종 작업 기록에 남긴다.
