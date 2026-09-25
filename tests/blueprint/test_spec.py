import gzip,json,tempfile,unittest,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts'))
from cm_spec import *
from scan_public_dist import scan
from muse_dispatch import make_command,get_model_ids,session_ids

class MaskingTests(unittest.TestCase):
    def test_vectors(self):
        for v in json.loads((ROOT/'contracts/masking-vectors.json').read_text(encoding='utf-8')):
            with self.subTest(v=v): self.assertEqual(mask_plate(v['input']),v['output'])
    def test_identity_retains_region(self):
        self.assertNotEqual(parse_plate('서울12가3456')[0],parse_plate('부산12가3456')[0])
        self.assertEqual(mask_plate('경기76자3623'),'경기7*자*6*3')
        # Different vehicles can still share a label; they must stay separate rows.
        self.assertEqual(mask_plate('서울12가3456'),mask_plate('서울13가3456'))
        self.assertNotEqual(parse_plate('서울12가3456')[0],parse_plate('서울13가3456')[0])
    def test_display_mask_before_output_only(self):
        records=[{'report_date':'2026-01-01','vehicle':'서울12가3456','count':2},
                 {'report_date':'2026-01-01','vehicle':'부산12가3456','count':1}]
        r=exact_vehicle_top5(records,start='2026-01-01',end='2026-01-31')
        self.assertEqual(len(r['items']),2);self.assertEqual([x['report_count'] for x in r['items']],[2,1])
        dumped=json.dumps(r,ensure_ascii=False)
        self.assertNotIn('서울12가3456',dumped);self.assertNotIn('12가3456',dumped)
        self.assertEqual([x['masked_plate'] for x in r['items']],['서울1*가*4*6','부산1*가*4*6'])
    def test_unrecognized_is_not_raw(self):
        for raw in ['외교123456','1가2','<script>12가3456</script>','서울'*40,42]:
            self.assertEqual(mask_plate(raw),'번호 확인 불가')

class MetricTests(unittest.TestCase):
    def test_rates(self):
        r=outcome_rates(60,20,20);self.assertEqual(r['accepted'],60);self.assertEqual(r['accepted_including_partial'],80)
    def test_zero(self):
        self.assertIsNone(percent(0,0));self.assertEqual(growth(7,0)['reason'],'new')
        self.assertEqual(growth(0,0)['reason'],'no_baseline');self.assertEqual(growth(0,10)['percent'],-100)
    def test_weighted_not_mean(self):self.assertEqual(percent(1,10),10)
    def test_invalid_counts(self):
        for n in [-1,True,1.5]:
            with self.assertRaises(ValueError):checked_count(n)
        with self.assertRaises(ValueError):percent(2,1)
    def test_axes_and_missing_completion(self):
        rows=[{'report_date':'2026-01-31','completed_date':'2026-02-02','disposition':'fine'},
              {'report_date':'2026-01-15','completed_date':None,'disposition':'fine'}]
        self.assertEqual(monthly_counts(rows,basis='report_date'),{'2026-01':2})
        self.assertEqual(monthly_counts(rows,basis='completed_date',disposition='fine'),{'2026-02':1})
    def test_kst_boundary(self):
        self.assertEqual(kst_day('2026-01-31T16:30:00Z').isoformat(),'2026-02-01')
    def test_date_window_leap(self):
        self.assertTrue(in_window('2024-02-29','2024-02-01','2024-02-29'))
        with self.assertRaises(ValueError):in_window('2026-01-01','2026-02-01','2026-01-01')
    def test_timezone_required(self):
        with self.assertRaises(ValueError):kst_day('2026-01-01T10:00:00')
    def test_single_record_published(self):
        r=exact_vehicle_top5([{'report_date':'2026-01-01','vehicle':'12가3456'}],start='2026-01-01',end='2026-01-31')
        self.assertEqual(r['items'][0]['report_count'],1)
    def test_missing_vehicle_stays_in_total(self):
        r=exact_vehicle_top5([{'report_date':'2026-01-01','vehicle':None}],start='2026-01-01',end='2026-01-31')
        self.assertEqual(r['total_scope_reports'],1);self.assertEqual(r['items'],[])
    def test_monthly_top5_cannot_be_summed(self):
        rows=[]
        for month in [1,2]:
            for i in range(5):rows.append({'report_date':f'2026-{month:02d}-01','vehicle':f'{20+month}가{1000+i}','count':11})
            rows.append({'report_date':f'2026-{month:02d}-01','vehicle':'99가9999','count':10})
        jan=exact_vehicle_top5(rows,start='2026-01-01',end='2026-01-31')
        combined=exact_vehicle_top5(rows,start='2026-01-01',end='2026-02-28')
        self.assertFalse(any(x['masked_plate']==mask_plate('99가9999') for x in jan['items']))
        self.assertEqual(combined['items'][0]['report_count'],20)
        self.assertEqual(combined['items'][0]['masked_plate'],mask_plate('99가9999'))
    def test_zero_count_not_a_vehicle_candidate(self):
        r=exact_vehicle_top5([{'report_date':'2026-01-01','vehicle':'12가3456','count':0}],start='2026-01-01',end='2026-01-31')
        self.assertEqual(r['items'],[]);self.assertEqual(r['total_scope_reports'],0)
    def test_reversed_empty_window_is_invalid(self):
        with self.assertRaises(ValueError):exact_vehicle_top5([],start='2026-02-01',end='2026-01-01')
    def test_region_scope(self):
        rows=[{'report_date':'2026-01-01','vehicle':'12가3456','region':'11'},
              {'report_date':'2026-01-01','vehicle':'12가3456','region':'26'}]
        r=exact_vehicle_top5(rows,start='2026-01-01',end='2026-01-31',region='11')
        self.assertEqual(r['total_scope_reports'],1)

class LeakTests(unittest.TestCase):
    def test_public_masked_ok(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'a.json').write_text(json.dumps({'manager_name':'예시담당가','masked_plate':'1*가*4*6'},ensure_ascii=False),encoding='utf-8')
            self.assertEqual(scan(Path(d)),[])
    def test_raw_and_secret_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'a.js').write_text('const plate="12가3456"; const secret="CM_SECRET_CANARY_NOT_PUBLIC";',encoding='utf-8')
            self.assertGreaterEqual(len(scan(Path(d))),2)
    def test_private_json_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'a.json').write_text('{"email":"fake@example.invalid"}',encoding='utf-8')
            self.assertTrue(scan(Path(d)))
    def test_gzip_is_scanned(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'app.js.gz').write_bytes(gzip.compress('12가3456'.encode()))
            self.assertTrue(scan(Path(d)))
    def test_internal_reference_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'references').mkdir();Path(d,'references/a.txt').write_text('not public')
            self.assertTrue(scan(Path(d)))

class DispatchTests(unittest.TestCase):
    def test_prompt_single_argv_no_eval(self):
        prompt='literal $(touch /tmp/SHOULD_NOT_RUN); `false`'
        cmd=make_command('opencode','/repo','verified/model',prompt,session='ses_test')
        self.assertEqual(cmd[-1],prompt);self.assertEqual(cmd.count('-s'),1);self.assertNotIn('-c',cmd)
    def test_no_fake_fork(self):
        with self.assertRaises(ValueError):make_command('opencode','/repo','verified/model','x',fork=True)
    def test_model_discovery(self):
        self.assertEqual(get_model_ids('\x1b[32mprovider/model-1\x1b[0m\nheader\n'),{'provider/model-1'})
    def test_session_events(self):
        self.assertEqual(session_ids('{"sessionID":"ses_test"}'),['ses_test'])
if __name__=='__main__':unittest.main()
