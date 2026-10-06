"""Regression ceilings for the measured slow paths; no product timeout overrides."""
import json
from benchmark import run,OUT
for size in [3000,30000]:
 for mode in ['force_custom_plan','force_generic_plan']:
  for concentrated in [False,True]:
   run(size,mode,'after',concentrated,False)
   data=json.loads((OUT/(f'after-{size}-{mode}'+('-concentrated' if concentrated else '')+'.json')).read_text())
   samples={r['case']:r for r in data['samples']}
   limits={'internal_analytics_cohort_state':100 if size==3000 else 500,
           'internal_analytics_v2_state':100 if size==3000 else 500,
           'internal_analytics_viewer':100 if size==3000 else 500,
           'internal_user_rankings':200 if size==3000 else 1500,
           'internal_analytics_v2_facts':1000 if size==3000 else 4000}
   for name,limit in limits.items():
    row=samples[name];assert row['error'] is None and row.get('response_error') is None,row
    assert row['ms']<limit,(size,mode,name,row['ms'],limit)
print('performance checks passed')
