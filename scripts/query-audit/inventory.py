"""Render the complete current-object inventory from catalog.py, with inferred call frequency."""
import json, pathlib, re
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/implementation/query-audit-20261006'
c=json.loads((OUT/'evidence/catalog-before.json').read_text())

# Record the source that creates each live relation/trigger/index; implicit indexes cite their table constraint.
all_sources=[]
for owner,root in [('map',ROOT),('auth',pathlib.Path('/home/better0101/projects/worktree/auth-perf'))]:
    for path in (root/'supabase/migrations').glob('*.sql'):
        if path.name[:12] <= '202610060100':all_sources.append((path.name,owner,str(path.relative_to(root)),path.read_text()))
all_sources.sort()
def location(kind,name,table=None):
    patterns={'table':r'create\s+table\s+(?:if\s+not\s+exists\s+)?'+re.escape(name)+r'\b',
              'trigger':r'create\s+trigger\s+'+re.escape(name)+r'\b',
              'index':r'create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?'+re.escape(name)+r'\b'}
    matches=[]
    for _,owner,path,txt in all_sources:
        for m in re.finditer(patterns[kind],txt,re.I):matches.append(f'{owner}:{path}:{txt[:m.start()].count(chr(10))+1}')
    if matches:return matches[-1]
    if kind=='index' and table:return location('table',table)+' (table constraint)'
    return 'local test object / no product migration'

def frequency(name):
    if name.startswith('internal_safeauth_'):
        if name=='internal_safeauth_cleanup':return '생성 요청의 5% 비동기 청소 / 선택적 시간당 cron(설정 미확인)'
        if name in ('internal_safeauth_poll','internal_safeauth_browser_status'):return '연결 대기 중 반복 poll'
        if name=='internal_safeauth_rate_limit':return 'relay/account 액션별 제한 검사'
        return '기기 연결 단계별 요청'
    if name.startswith('internal_account_'):return '로그인·화면 진입·공유 동의·기기 연결/해제 요청'
    if name.startswith('internal_community_'):return '실시간·수동·자정 업로드/manifest; 삭제는 사용자 요청'
    if name.startswith('internal_my_reports_'):return '확장 프로그램의 내 신고 요약·검색·번호 페이지 요청'
    if name=='internal_user_rankings':return '랭킹 화면·조건·페이지 변경'
    if name in ('internal_activate_snapshot','internal_cleanup_expired','internal_my_analytics_source','internal_analytics_v2_facts'):return '현재 Edge 호출 없음; 남아 있는 서비스 RPC/레거시·정리'
    if name.startswith('internal_agency_'):return '운영자 기관 키 재계산 배치'
    if name=='internal_my_analytics_cohort_source':return '개인 비교·내 맞춤 통계 요청'
    if name.startswith('internal_analytics_'):return '지도/메타/통계/열람 gate 요청마다; 상세는 호출 경로 참조'
    return '아래 상위 함수 또는 트리거가 호출할 때'

s=['# Supabase 전체 쿼리 목록 · 2026-10-06','',
'기준 map `5cf45c6`, auth `151adfd`. 운영 프로젝트에 접속하지 않았다. 공유 manifest의 미적용 AUTH `202610050100`과 MAP `202610060100`을 **로컬 트랜잭션에서만** 적용한 카탈로그를 기준으로 한다. 이전 정의를 중복 계수하지 않으며 drop된 `internal_my_reports`는 현재 목록에서 제외한다.',
'', '호출 빈도는 코드에서 추정한 발생 시점이며 운영 트래픽 수치가 아니다. 신규 감사 migration은 이 표의 **수정 전 기준** 다음에 적용한다. 원문·signature·권한·내부 의존성은 [catalog-before.json](evidence/catalog-before.json)에 있다.',
'', '## RPC·함수 74개', '', '| 객체 | 최신 정의 (소유 repo:파일:줄) | 직접 호출부 / 내부 호출자 | 빈도·용도 |','|---|---|---|---|']
for f in c['functions']:
    src=f['source'];fn_location=f"{src['repo']}:{src['path']}:{src['line']}" if src else 'migration 소유 없음'
    sites=[f"{r['repo']}:{r['path']}:{r['line']}" for r in f['call_sites'] if r['path'].startswith(('server/','supabase/functions/','src/','site/')) or r['path']=='scripts/recompute-agency-keys.mjs']
    callers=sites+[x for x in f['callers']]
    if not callers:
        callers=[t['table']+' trigger '+t['name'] for t in c['triggers'] if (f['schema']+'.'+f['name']+'(') in t['function']]
    s.append(f"| `{f['schema']}.{f['name']}` | `{fn_location}` | "+'<br>'.join('`'+x+'`' for x in callers or ['현재 제품 직접 호출 없음'])+f" | {frequency(f['name'])} |")
s+=['','## 테이블·뷰·RLS','', '현재 제품 view/materialized view는 **0개**다. 이름이 `public_map_points`여도 실제로는 테이블이다. `public.it_realtime_control`과 그 `rt_read` 정책은 기존 로컬 테스트 잔여 객체로 제품 migration 소유가 아니다. 나머지 28개는 제품 테이블이다. 제품 RLS 정책은 0개: RLS 활성 테이블은 기본 거부이며 RPC의 SECURITY DEFINER/service_role 경계로 접근한다. 지역/registry 정적 참조 테이블은 RLS 대신 private schema/ACL로 제한한다. 따라서 행마다 `auth.uid()`를 실행하는 제품 정책은 없다.',
'', '| 테이블 | 현재 생성 정의 | RLS / 강제 RLS | 정책 | 접근 비용 측정 |','|---|---|---|---|---|']
for t in c['tables']:
    policies=[p for p in c['policies'] if p['schemaname']==t['schema'] and p['tablename']==t['name']]
    s.append(f"| `{t['schema']}.{t['name']}` | `{location('table',t['schema']+'.'+t['name'])}` | {t['rls']} / {t['force_rls']} | "+'; '.join(p['policyname']+': '+str(p['qual']) for p in policies or [])+" | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |")
s+=['','## 트리거 8개','','| 테이블 / 트리거 | 현재 정의 | 실행 함수 | 호출 시점 |','|---|---|---|---|']
for t in c['triggers']:s.append(f"| `{t['table']}` / `{t['name']}` | `{location('trigger',t['name'])}` | `{t['function']}` | `{t['definition']}` |")
s+=['','## 인덱스 60개','','인덱스는 그 테이블의 SELECT/DML 실행계획과 쓰기 비용에서 측정한다. 인덱스를 독립 쿼리처럼 측정했다고 표시하지 않는다. PK/UNIQUE가 제공하는 인덱스도 포함한다.','','| 테이블 | 인덱스 | 현재 생성 정의 | SQL |','|---|---|---|---|']
for i in c['indexes']:s.append(f"| `{i['schemaname']}.{i['tablename']}` | `{i['indexname']}` | `{location('index',i['indexname'],i['schemaname']+'.'+i['tablename'])}` | `{i['indexdef']}` |")
s+=['','## Edge·웹의 왕복 경로','','| 경로 | 순차 호출 | 빈도 / 판단 |','|---|---|---|',
'| public-analytics 일반 조회 | Auth getUser → viewer RPC → rate RPC → cohort state RPC → facts 또는 rollup RPC | 조회 1회당 Auth 1 + DB 4. facts별 RPC 반복/N+1 없음. gate·rate 거절 순서는 계약이므로 무작정 병렬화하지 않음 |',
'| public-analytics meta/catalog | Auth → viewer → rate → state | Auth 1 + DB 3. catalog의 state는 반환에 쓰이지 않는 후보(계약/호출 실패 의미를 검토) |',
'| my-analytics | Auth → rate → personal source RPC(내부 state/facts) | Auth 1 + DB 2, 행별 네트워크 호출 없음 |',
'| my-reports | Auth → rate → summary/search/numbers RPC | Auth 1 + DB 2, 페이지별 한 RPC |',
'| user-rankings | Auth → rate → rankings RPC(내부 viewer) | Auth 1 + DB 2 |',
'| community-ingest upload | Auth → user rate → connection rate → ingest RPC | 배치별 호출, DB 함수 내부 이벤트 루프는 별도 측정 |',
'| community-ingest manifest | Auth → user rate → manifest RPC | 5천 건 페이지마다 1 RPC, 원시 keys 전체 반환 없음 |',
'| community-account | Auth → rate → action RPC | 등록/재동의/철회/삭제마다; 앱의 실시간/수동/자정 흐름도 이 경로 |',
'| community-auth-relay | capability/Auth 검사 → rate → action RPC; create 5% cleanup | poll/브라우저 상태 반복, 전역 capacity lock 보존 |',
'', '웹 클라이언트에서 제품 DB로 직접 `.from().select()`/RPC를 호출하는 경로는 발견되지 않았다. 지도는 Edge API를, auth 사이트는 Auth OAuth/relay를 호출한다. `.from` 문자열 중 `Array.from`, `Buffer.from`은 DB 접근이 아니다. Supabase Auth 내부 플랫폼 쿼리는 저장소 소유 SQL이 아니며 getUser/OAuth 통합 검증으로 구분한다. 앱 저장소는 수정하지 않는다.',
'', '## 재현', '', '`python3 scripts/query-audit/catalog.py --auth /path/to/auth-perf --installed --out /tmp/query-audit-current.json`으로 현재 설치 상태를 읽는다. 기준 catalog-before.json은 감사 시작 시 저장한 불변 oracle이므로 덮지 않는다. `python3 scripts/query-audit/inventory.py`는 보관된 두 카탈로그에서 표를 재생성한다.']
after_path=OUT/'evidence/catalog-after.json'
if after_path.exists():
    after=json.loads(after_path.read_text());old={f['schema']+'.'+f['name']:f for f in c['functions']}
    s+=['','## 감사 migration 적용 후 현재 정의','','함수 76개 / 트리거 10개 / 인덱스 60개. 아래 11개 함수 외에는 위 기준 정의와 동일하다. 인덱스·테이블·RLS 정책 변경은 없다.','','| 함수 | 현재 정의 |','|---|---|']
    for f in after['functions']:
        key=f['schema']+'.'+f['name'];before=old.get(key)
        if before is None or before['definition']!=f['definition']:
            src=f['source'];s.append(f"| `{key}` | `{src['repo']}:{src['path']}:{src['line']}` |")
    s+=['','fact의 기존 `community_report_facts_manifest`는 `060300`에서 UPDATE 전용 ROW 트리거가 되며, INSERT/DELETE statement 트리거 2개가 같은 파일에서 추가된다. 실제 호출별 측정 매핑은 [coverage.json](evidence/coverage.json), 전후 전체 표는 [MEASUREMENTS.md](MEASUREMENTS.md)에 있다.']
(OUT/'INVENTORY.md').write_text('\n'.join(s)+'\n')
print('Inventory:',len(c['functions']),'functions;',len(c['indexes']),'indexes')
