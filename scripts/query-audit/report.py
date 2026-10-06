"""Render comparisons from recorded server measurements, preserving failures/timeouts."""
import json,pathlib
from benchmark import OUT
DEST=OUT.parent

def get(phase,size,mode,conc,write):
 name=('write-' if write else '')+f'{phase}-{size}-{mode}'+('-concentrated' if conc else '')+'.json'
 return {r['case']:r for r in json.loads((OUT/name).read_text())['samples']}
def time(r):return f"{r['ms']:.1f}"+(f" ({r['error']})" if r['error'] else '')
lines=['# 전체 실행시간 비교','',
'단위 ms. 각 칸은 **수정 전 → 후**이며 오류 SQLSTATE도 숨기지 않는다. 측정은 로컬 서버 1회 호출이며 p95/운영 SLA가 아니다. 계획 계측은 별도 실행했다. 8초 진단 한도는 제품 타임아웃을 늘린 값이 아니다. `P0001` 정책 불변성 거부는 예상 결과다.','',
'3천 fact는 30계정/120동의 이력/60기기, 3만 fact는 300계정/1,200동의 이력/600기기다. 계정 1개에 전체 facts를 넣은 집중 조건도 측정한다. revoked/suspended 계정, 같은 lineage의 이전 동의, NULL 날짜/번호, 중복 관측과 공개 정책 차이가 포함된다. 운영 계정 수가 제공되지 않아 합성 가정이며 운영 자료에서 추출한 분포가 아니다.','',
'읽기 raw facts 3천 건 약 3.4 MB / 3만 건 약 36 MB의 JSONB 반환 비용을 포함한다. 각 scalar helper는 명시적 호출로, trigger는 실제 DML로, index는 그 계획과 DML 비용으로 측정한다. my_reports 배열 helper 시간에는 own 배열 생성도 포함하므로 helper 자체의 단독 시간으로 해석하지 않는다.','']
for conc in [False,True]:
 lines+=['## '+('한 계정 집중' if conc else '계정 분산'),'', '| 호출 / 동작 | 3천 custom | 3천 generic | 3만 custom | 3만 generic |','|---|---:|---:|---:|---:|']
 for write in [False,True]:
  cache={(phase,size,mode):get(phase,size,mode,conc,write) for phase in ['before','after'] for size in [3000,30000] for mode in ['force_custom_plan','force_generic_plan']}
  for label in cache['before',3000,'force_custom_plan']:
   row=['`'+label+'`']
   for size in [3000,30000]:
    for mode in ['force_custom_plan','force_generic_plan']:
     row.append(time(cache['before',size,mode][label])+' → '+time(cache['after',size,mode][label]))
   lines.append('| '+' | '.join(row)+' |')
lines+=['','## 계획과 원자료','',
'`evidence/{before,after}-{3000,30000}-force_{custom,generic}_plan.json`: 읽기 latency. `write-` 접두사는 변경·helper 호출이며 각 작업 후 savepoint rollback한다. `-concentrated`는 한 계정 집중, `-plans.json`은 EXPLAIN ANALYZE BUFFERS JSON, `-plans-stderr.txt`는 auto_explain nested 계획이다. 작은 내부 문장은 직접 helper 호출 계획과 함께 해석한다.','',
'`rls-*.json`: 실제 anon/authenticated/service_role 접근과 별도 임시 SELECT 권한 진단. 제품 private 테이블의 실제 ACL 거부(42501)와 RLS 기본 거부를 구분한다. 임시 진단 권한은 전부 rollback하며 실제 앱 권한을 바꾸지 않는다.','',
'`parity-*.json`: 같은 트랜잭션의 수정 전후 응답 비교. ranking의 요청 시각 `generated_at`만 두 별도 호출의 시각 차이 때문에 제외했다. 별도 회귀 검사는 같은 SQL 문장에서 원본 alias와 후보를 실행하므로 그 필드까지 동일 비교한다. 3만 generic의 원본 v2/personal timeout 2개는 동등성 PASS로 세지 않는다; 3만 custom에서는 해당 응답도 완전 비교한다.']
lines+=['','## 추가 필터 분기','','같은 트랜잭션의 전후 전체 JSON 비교(20/20 일치)와 비계측 시간. 지역·법규·bbox·월·기관별 조건을 분리했다.','','| 필터 | 3천 custom | 3천 generic | 3만 custom | 3만 generic |','|---|---:|---:|---:|---:|']
for label in ['region','law','bbox','month','agency']:
 row=['`'+label+'`']
 for size in [3000,30000]:
  for mode in ['force_custom_plan','force_generic_plan']:
   samples=json.loads((OUT/'filters'/f'parity-{size}-{mode}.json').read_text())['samples']
   measured=[r for r in samples if r.get('case')==label]
   assert len(measured)==2
   row.append(time(measured[0])+' → '+time(measured[1]))
 lines.append('| '+' | '.join(row)+' |')
(DEST/'MEASUREMENTS.md').write_text('\n'.join(lines)+'\n')
# Every callable function has an explicit case or a trigger operation; no false claim of timing indexes alone.
cat=json.loads((OUT/'catalog-before.json').read_text())
read=get('after',3000,'force_custom_plan',False,False);write=get('after',3000,'force_custom_plan',False,True);labels=list(read)+list(write)
trigger={'community_policies_immutable':'triggers/policy-immutable','community_policy_texts_immutable':'triggers/policy-text-immutable','touch_updated_at':'triggers/profile-update','invalidate_analytics_v2':'triggers/profile-update + internal_activate_snapshot','community_facts_manifest_trigger':'triggers/insert-bulk + triggers/update-state + triggers/delete-bulk','community_facts_projection_trigger':'triggers/insert-bulk + triggers/update-state + triggers/delete-bulk','community_stamp_registry_version':'triggers/insert-bulk + internal_agency_recompute_apply','internal_analytics_rollup':'rollup/agency + manager + laws + series'}
coverage=[]
for f in cat['functions']:
 matches=[l for l in labels if l==f['name'] or l.startswith(f['name']+'/')]
 case=trigger.get(f['name'],' + '.join(matches));assert case,f['name']
 coverage.append({'function':f['schema']+'.'+f['name'],'case':case})
coverage.extend([{'function':'private.community_facts_manifest_insert_batch','case':'triggers/insert-bulk + triggers/insert-one','introduced':'202610060300'}, {'function':'private.community_facts_manifest_delete_batch','case':'triggers/delete-bulk + internal_community_delete_contributions','introduced':'202610060300'}])
(OUT/'coverage.json').write_text(json.dumps(coverage,indent=2)+'\n')
print(len(coverage),'functions covered;',len(read)+len(write),'explicit scenarios per matrix cell')
