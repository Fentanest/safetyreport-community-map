"""Derive report tables from retained raw measurements, never synthesize missing samples."""
import json,math,pathlib,statistics
root=pathlib.Path(__file__).resolve().parents[2]/'docs/refactoring/map-performance';e=root/'evidence'
read=lambda p:json.loads(p.read_text())
q=lambda xs,p:sorted(xs)[math.ceil(len(xs)*p)-1]
rows=[];md=['# 실측 요약','', '각 표본의 첫 실행을 포함한다. 시간은ms, bytes는 uncompressed다. 성격이 다른 표 사이의 개선율은 산출하지 않는다. 상세 환경·한계: PERFORMANCE.md.','', '## Node CPU 합성 fixture (HTTP/운영 아님)','', '| 규모 | 경로 | n 전/후 | p50 전→후 | p95 전→후 | bytes 전→후 | 실패율 전/후 |','|---:|---|---:|---:|---:|---:|---:|']
before=read(e/'before/bounded/public-analytics.json')['results']+read(e/'before/heavy/public-analytics.json')['results'];after=read(e/'after/cpu/public-analytics.json')['results']
for a in after:
 b=next(x for x in before if x['size']==a['size'] and x['route']==a['route']);row={'kind':'CPU fixture','size':a['size'],'route':a['route'],'before':b,'after':a};rows.append(row)
 md.append(f"| {a['size']:,} | {a['route'].split('?')[0]} | {b['requests']}/{a['requests']} | {b['p50_ms']:.2f}→{a['p50_ms']:.2f} | {b['p95_ms']:.2f}→{a['p95_ms']:.2f} | {b['samples'][0]['bytes']}→{a['samples'][0]['bytes']} | {b['failure_rate']:.1%}/{a['failure_rate']:.1%} |")
md+=['','## 같은 seed/connection 랭킹 SQL (50만 사용자별 고유 /60만 관측)','', '| 지표 | n | p50 전→후 | p95 전→후 | 단축 p50/p95 | bytes 전→후 |','|---|---:|---:|---:|---:|---:|']
for folder in ['paired-ranking','binary-ranking','binary-ranking-timing-final']:
 p=e/folder/'500k-measurements.json'
 if not p.exists():continue
 d=read(p);times=d['query_total_ms']
 for metric in ['first','rates']:
  b=[v for k,v in times.items() if k.startswith('before-'+metric+'-')];a=[v for k,v in times.items() if k==metric or k.startswith('repeat-'+metric+'-')]
  row={'kind':'ranking SQL','candidate':folder,'metric':metric,'n_before':len(b),'n_after':len(a),'p50_before':q(b,.5),'p95_before':q(b,.95),'p50_after':q(a,.5),'p95_after':q(a,.95),'rss_kib':d['db_process_peak_rss_kib'],'interleaved':d.get('interleaved',False)};rows.append(row)
  md.append(f"| {folder}/{metric} | {len(b)}/{len(a)} | {q(b,.5):.2f}→{q(a,.5):.2f} | {q(b,.95):.2f}→{q(a,.95):.2f} | {1-q(a,.5)/q(b,.5):.1%}/{1-q(a,.95)/q(b,.95):.1%} | {d['responses']['before-'+metric+'-1']['bytes']}→{d['responses'][metric]['bytes']} |")
md+=['','paired-ranking은 후보6조회→원본20조회→후보18조회의 block 순서다. binary-ranking은 양쪽 nested auto_explain analyze를 켠 교대 진단값이고, binary-ranking-timing-final은 양쪽 계측을 끈 교대 시간표본(진단outer60s)이다. 계획 계측 overhead가 있으므로 두 실행을 하나의 개선율로 합치지 않는다. 같은 connection이라도 시간 순서·warm plan 효과를 숨기지 않는다. RSS는 공유 페이지/allocator를 포함하는 프로세스 수치이며 쿼리 전용 메모리로 부르지 않는다.','', '## Native SQL 글로벌50만/60만 관측','', '| 종류 | n | p50/p95 | bytes | 기대 대표 수 | 실패율 |','|---|---:|---:|---:|---:|---:|']
p=e/'rollup-final/measurements.json'
if p.exists():
 d=read(p)
 for kind in ['manager','laws','series']:
  samples=[x for x in d['samples'] if x['label'].startswith('after-'+kind+'-')];xs=[x['ms'] for x in samples];rows.append({'kind':'native SQL','route':kind,'samples':samples})
  md.append(f"| {kind} | {len(xs)} | {q(xs,.5):.2f}/{q(xs,.95):.2f} | {samples[0]['bytes']} | {samples[0]['n']} | 0% |")
 md+=['',f"원본 bounded raw RPC 직접SQL: 계약상태={d['samples'][0]['status']}, {d['samples'][0]['ms']:.2f}ms,1표본. p50/p95가 아니며 성공 경로와 개선율을 비교하지 않는다. 제품 timeout config20s, 진단 outer statement budget{d['diagnostic_timeout_seconds']}s. HTTP/운영 성공 증거 아님."]
md+=['','## Normal local HTTP (real auth/rate/SQL, synthetic data500)','', '| 동시 사용자 | 경로 | 요청 전/후 | p50 전→후 | p95 전→후 | bytes | 실패율 전/후 |','|---:|---|---:|---:|---:|---:|---:|']
for c in [1,3,5]:
 folder=next((f for f in [f'http-{c}-verified',f'http-{c}-final',f'http-{c}'] if (e/f/'measurements.json').exists()),f'http-{c}')
 p=e/folder/'measurements.json'
 if not p.exists():continue
 rs=read(p)['results']
 for a in [r for r in rs if r.get('variant')=='after' and 'p50_ms' in r]:
  b=next(r for r in rs if r.get('variant')=='before' and r['route']==a['route']);rows.append({'kind':'normal HTTP','concurrency':c,'before':b,'after':a})
  md.append(f"| {c} | {a['route'].split('?')[0]} | {b['requests']}/{a['requests']} | {b['p50_ms']:.2f}→{a['p50_ms']:.2f} | {b['p95_ms']:.2f}→{a['p95_ms']:.2f} | {b['bytes']}→{a['bytes']} | {b['failure_rate']:.1%}/{a['failure_rate']:.1%} |")
md+=['','## Production frontend (demo/mock,30 cold entries)','', '| 화면 | n 전/후 | 첫 콘텐츠 p50 전→후 | 사용 가능 p50 전→후 | 사용 가능 p95 전→후 | 요청 총 전→후 | JS bytes p50 전→후 | 실패율 |','|---|---:|---:|---:|---:|---:|---:|---:|']
p=e/'production-latest/measurements.json'
if p.exists():
 rs=read(p)['results']
 for a in [r for r in rs if r['variant']=='after']:
  b=next(r for r in rs if r['variant']=='before' and r['screen']==a['screen']);rows.append({'kind':'production UI fixture','before':b,'after':a})
  md.append(f"| {a['screen']} | {len(b['samples'])}/{len(a['samples'])} | {b['first_content_p50_ms']:.2f}→{a['first_content_p50_ms']:.2f} | {b.get('p50_ms',float('nan')):.2f}→{a.get('p50_ms',float('nan')):.2f} | {b.get('p95_ms',float('nan')):.2f}→{a.get('p95_ms',float('nan')):.2f} | {b['requests']}→{a['requests']} | {statistics.median(s['js_bytes'] for s in b['samples']):.0f}→{statistics.median(s['js_bytes'] for s in a['samples']):.0f} | {b['failure_rate']:.1%}/{a['failure_rate']:.1%} |")
md+=['','## Production frontend 독립 프로세스 재측정 (앞선 회귀 결과 보존)','', '| 화면 | n 전/후 | p50 전→후 | p95 전→후 | 요청 총 전→후 | JS bytes p50 전→후 | 실패율 전/후 |','|---|---:|---:|---:|---:|---:|---:|']
p=e/'production-isolated/measurements.json'
if p.exists():
 rs=read(p)['results']
 for a in [r for r in rs if r['variant']=='after']:
  b=next(r for r in rs if r['variant']=='before' and r['screen']==a['screen']);rows.append({'kind':'production UI isolated repeat','before':b,'after':a})
  md.append(f"| {a['screen']} | {len(b['samples'])}/{len(a['samples'])} | {b['p50_ms']:.2f}→{a['p50_ms']:.2f} | {b['p95_ms']:.2f}→{a['p95_ms']:.2f} | {b['requests']}→{a['requests']} | {statistics.median(s['js_bytes'] for s in b['samples']):.0f}→{statistics.median(s['js_bytes'] for s in a['samples']):.0f} | {b['failure_rate']:.1%}/{a['failure_rate']:.1%} |")
md+=['','각 화면/variant마다 새 browser process, 같은30 cold contexts/fixture/readiness다. 앞선 production-latest의3화면/180context 공유browser 회귀를 삭제하거나 이 값으로 대체하지 않는다. 실행 순서·프로세스 누적·외부 widgets 요청 등 원인을 확정하지 못했다. dashboard 후 요청1065에는 변동하는 외부 요청이 포함되며 API 요청은 양쪽0이다.']
md+=['','dashboard는 실제KPI+mock map+7 charts가 준비된 시점, 통계/랭킹은 실제 결과 행이다. bytes/requests는 networkidle 뒤 기록했다. 최초 코드/인증 fixture/결과를 포함한 end-to-end fixture이며 운영 auth 후 지연/RUM은 아니다.','']
(root/'measurements-summary.md').write_text('\n'.join(md));(e/'measurements-summary.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print('Derived',len(rows),'rows')
