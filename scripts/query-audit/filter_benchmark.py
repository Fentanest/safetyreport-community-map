"""Selected non-default filter branches, using the same SQL/parity/plan harness."""
import json
import benchmark as b
original=b.cases
b.OUT=b.OUT/'filters'
def cases():
 result={}
 for label,patch in [('region',{'region_code':'11'}),('law',{'law':'합성법 제2조'}),('bbox',{'bbox':[127.1,37.1,127.3,37.3]}),('month',{'start':'2026-06-01','end':'2026-06-30'}),('agency',{'agency_key':'agency-1'})]:
  scope={**json.loads(b.SCOPE),**patch}
  options="jsonb_build_object('page',1,'page_size',100,'q','','sort',jsonb_build_object('column','completed','value','count','dir','desc'),'expected_version',(select dataset_version from private.analytics_state where singleton))"
  result[label]=f"select public.internal_analytics_rollup({b.lit(json.dumps(scope))}::jsonb,'agency',{options}) as value"
 return result
b.cases=cases
def verify():
 for size in [3000,30000]:
  for mode in ['force_custom_plan','force_generic_plan']:
   rows=json.loads((b.OUT/f'parity-{size}-{mode}.json').read_text())['samples']
   parity=[r for r in rows if 'parity' in r]
   assert len(parity)==5 and all(r['equal'] and r['before_error'] is None and r['after_error'] is None for r in parity),parity
   measured=[r for r in rows if r.get('case')=='region']
   assert len(measured)==2 and measured[-1]['error'] is None
   assert measured[-1]['ms']<(150 if size==3000 else 2000),measured
 print('20 filter parity checks and 4 region performance checks passed',flush=True)
if __name__=='__main__':
 for size in [3000,30000]:
  for mode in ['force_custom_plan','force_generic_plan']:
   b.run(size,mode,'parity',False,False)
   b.run(size,mode,'before',False,True)
   b.run(size,mode,'after',False,True)

 verify()
