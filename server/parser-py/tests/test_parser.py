import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from services import parser, fine_estimate
from services.fine_amount_syntax import explicit_fine_number
from services.case_fine_supplement import supplement_case_fine
from services.law_values import canonical_law, primary_law
from services.law_selection import choose
from parse_report import parse_report,derive_fact
from community_adapter import build_payload,payload_sha256

def load(name): return json.loads((ROOT/'contracts'/name).read_text())
def as_columns(detail: dict) -> dict:
    d = parser.parse_json_details(detail)
    title = d["title_fields"]
    sup = d["supplement_summary"]
    return {
        "신고번호": title["신고번호"], "신고명": title["신고명"], "신고일": title["신고일"], "상태": title["상태"],
        "만족도조사여부": title["만족도조사여부"], "별점": title.get("별점"),
        "entry_value": d["entry_value"], "ssnpc_cd": d["ssnpc_cd"], "ssnpc_type": d["ssnpc_type"],
        "처리상태": d["processing_status"], "종결여부": d["processing_finish"],
        "처리기관": d["processing_agency"], "처리기관코드": d["processing_agency_code"], "담당자": d["person_in_charge"], "답변일": d["response_date"],
        "처리내용": d["processing_content"], "위반법규": d["violation_law"], "범칙금_과태료": d["penalty_amount"], "벌점": d["penalty_points"],
        "차량번호": d["car_number"], "발생일자": d["occurrence_date"], "발생시각": d["occurrence_time"], "위반장소": d["violation_location"],
        "위도": d["violation_latitude"], "경도": d["violation_longitude"],
        "신고내용": d["report_content"], "첨부사진": d["attached_photos"], "첨부파일": d["attachment_files"], "지도": d["map_image"],
        "raw_content": d["raw_content"],
        "보완횟수": int(sup.get("count") or 0), "보완_미응답": sup.get("is_open") or "N", "보완_요청자": sup.get("requester") or "",
        "보완_요청_내용": sup.get("request_text") or "", "보완_신고자_의견": sup.get("reporter_opinion") or "",
    }
class ParserTests(unittest.TestCase):
    def test_current_worker_matches_derivation_fixture(self):
        for c in load('derived-v1.json'):
            with self.subTest(case=c['name']):self.assertEqual(derive_fact(c['payload']),c['derived'])
    def test_all_parser_vectors(self):
        for case in load('parser-vectors.json')['cases']:
            with self.subTest(case=case['name']):
                result=as_columns(case['detail'])
                for k,v in case['expect'].items():self.assertEqual(result[k],v)

    def test_law_vectors(self):
        for case in load('law-parser-vectors.json')['cases']:
            with self.subTest(case=case['name']):
                law=parser._violation_law(case['answer'])
                self.assertEqual(canonical_law(primary_law(law)),case['primary'])
                if 'selected' in case:self.assertEqual(choose(case['answer'])['selected'],case['selected'])
                if 'value' in case:self.assertEqual(law,case['value'])
    def test_case_fine_vectors(self):
        for c in load('case-fine-supplement-vectors.json')['cases']:
            with self.subTest(case=c['name']):
                self.assertEqual(supplement_case_fine(c['status'],c['penalty'],c['text']),(c['expected_status'],c['expected_penalty']))
    def test_explicit_vectors(self):
        for c in load('explicit-fine-vectors.json')['cases']:
            with self.subTest(case=c['name']):
                self.assertEqual(explicit_fine_number(c['text']),c['number'])
                raw=f"과태료: {c['number']}원" if c['number'] is not None else '과태료'
                record={'category':'parking','entry_value':'불법주정차신고-기타 불법주정차','위반법규':'도로교통법 제32조','차량번호':'12가3456'}
                self.assertEqual(fine_estimate.extract_fine_amount(raw,record),c['amount'])
    def test_raw_vectors(self):
        spec=importlib.util.spec_from_file_location('raw_detail',ROOT/'provenance/core/utils/raw_detail.py')
        import types
        fallback=types.ModuleType('core.utils.fallback');fallback.note_fallback=lambda *a: None
        sys.modules.setdefault('core',types.ModuleType('core'));sys.modules.setdefault('core.utils',types.ModuleType('core.utils'));sys.modules['core.utils.fallback']=fallback
        raw=importlib.util.module_from_spec(spec);spec.loader.exec_module(raw)
        for c in load('raw-detail-vectors.json')['cases']:
            with self.subTest(case=c['name']):
                b=raw.canonical_bytes(c['input']);self.assertEqual(b,c['canonical'].encode());self.assertEqual(raw.sha256_hex(b),c['sha256'])
    def test_complete_parse_private_and_supplement(self):
        # Entirely synthetic. Public DTO must not contain the private canaries.
        result={'C_NO':'SYNTHETIC01','C_NOW':10,'C_A_CONTENTS':'PRIVATE_CANARY_BODY','C_A_TITLE':'합성 신고',
            'answers':[{'C_MANAGER_TYPE_NM':'수용','C_MANAGE_CONTENTS':'PRIVATE_CANARY_ANSWER','C_DEPT_NAME':'합성기관'}]}
        body=json.dumps({'result':result},ensure_ascii=False)
        supp=dict(rating=4,rating_cause='PRIVATE_CANARY_REASON',survey_state='완료',photo_first_at='2026-10-20 10:00:00',photo_last_at=None,photo_count=1,
            list=dict(title='합성 제목',report_date='2026-10-20',status='답변완료',entry_value=None,ssnpc_cd=None,ssnpc_type=None))
        row=dict(raw_text=body,raw_sha256=hashlib.sha256(body.encode()).hexdigest(),supplement=supp,client_observation={})
        parsed,payload,derived,diff=parse_report(row)
        self.assertEqual(parsed['rating'],4);self.assertEqual(parsed['rating_cause'],'PRIVATE_CANARY_REASON')
        self.assertIn('PRIVATE_CANARY_BODY',parsed['report_content'])
        self.assertNotIn('PRIVATE_CANARY',json.dumps(payload));self.assertNotIn('PRIVATE_CANARY',json.dumps(derived))
        self.assertTrue(diff);row['client_observation']=payload;self.assertEqual(parse_report(row)[3],{})
        row['raw_sha256']='0'*64
        with self.assertRaises(ValueError):parse_report(row)
    def test_parser_categories(self):
        from services import report_category
        for c in load('report-categories.json')['vectors']:
            with self.subTest(case=c.get('name')):
                self.assertEqual(report_category.category_of(c.get('ssnpc_cd'),c.get('ssnpc_type'),c.get('entry_value','')),c['expect']['category'])


def _row(result, supplement=None, client=None):
    body = json.dumps({'result': result}, ensure_ascii=False)
    supp = supplement or dict(rating=None, rating_cause=None, survey_state=None, photo_first_at=None, photo_last_at=None, photo_count=None,
        list=dict(title=None, report_date=None, status=None, entry_value=None, ssnpc_cd=None, ssnpc_type=None))
    return dict(raw_text=body, raw_sha256=hashlib.sha256(body.encode()).hexdigest(), supplement=supp, client_observation=client)


ANSWERED = {'C_NO': 'SYNTHETIC02', 'C_NOW': 10, 'C_A_TITLE': '합성', 'C_A_CONTENTS': '합성 본문',
            'answers': [{'C_MANAGER_TYPE_NM': '수용', 'C_MANAGE_CONTENTS': '합성 답변', 'C_DEPT_NAME': '합성기관', 'C_DATE': '2026-10-20 10:00:00'}]}


class PcEquivalenceTests(unittest.TestCase):
    """W-M3: the server DTO uses exactly the PC capture inputs; no list/supplement fallbacks of its own."""

    def listing(self, **over):
        base = dict(rating=None, rating_cause=None, survey_state=None, photo_first_at=None, photo_last_at=None, photo_count=None,
                    list=dict(title='목록 제목', report_date='2026-10-19', status='답변완료', entry_value='불법주정차신고-기타 불법주정차',
                              ssnpc_cd='99', ssnpc_type='Z'))
        base.update(over)
        return base

    def test_empty_entry_value_stays_empty(self):
        from services import report_category
        parsed, payload, _, _ = parse_report(_row(dict(ANSWERED), self.listing()))
        self.assertEqual(parsed['entry_value'], '')
        # PC: category_of(rec.ssnpc_cd, rec.ssnpc_type, rec.entry_value) with the detail values, never the list ones.
        self.assertEqual(payload['category'], report_category.category_of(None, None, ''))
        self.assertNotEqual(payload['category'], report_category.category_of(None, None, '불법주정차신고-기타 불법주정차'))

    def test_report_date_null_without_c_date(self):
        _, payload, _, _ = parse_report(_row(dict(ANSWERED), self.listing()))
        self.assertIsNone(payload['report_date'])
        with_date = dict(ANSWERED, C_DATE='2026-10-18 09:00:00')
        self.assertEqual(parse_report(_row(with_date, self.listing()))[1]['report_date'], '2026-10-18')

    def test_rating_is_client_enriched_value_not_stsfdg(self):
        scored = dict(ANSWERED, STSFDG_SCORE=5)
        parsed, payload, _, _ = parse_report(_row(scored, self.listing(rating=None)))
        self.assertIsNone(payload['rating']); self.assertIsNone(parsed['rating'])
        parsed, payload, derived, _ = parse_report(_row(scored, self.listing(rating=3)))
        self.assertEqual((payload['rating'], parsed['rating'], derived['rating']), (3, 3, 3))

    def test_ssnpc_pair_from_detail_only(self):
        parsed, _, _, _ = parse_report(_row(dict(ANSWERED), self.listing()))
        self.assertEqual((parsed['ssnpc_cd'], parsed['ssnpc_type']), (None, None))

    def test_diff_null_without_observation(self):
        row = _row(dict(ANSWERED), self.listing())
        self.assertIsNone(parse_report(row)[3])
        payload = parse_report(row)[1]
        row['client_observation'] = payload
        self.assertEqual(parse_report(row)[3], {})


class TimezoneTests(unittest.TestCase):
    """W-M2: supplement epochs are formatted in local time; the worker requires KST like the PC."""

    def setUp(self):
        import os, time
        self._tz = os.environ.get('TZ')

    def tearDown(self):
        import os, time
        if self._tz is None: os.environ.pop('TZ', None)
        else: os.environ['TZ'] = self._tz
        time.tzset()

    def _set(self, tz):
        import os, time
        os.environ['TZ'] = tz; time.tzset()

    def test_supplement_timestamp_is_kst(self):
        self._set('Asia/Seoul')
        result = dict(ANSWERED, SPLMNT_DMND_NO=1, SPLMNT_DMND_DT=1760000000000, SPLMNT_FNSH_DT=1760003600000, SPLMNT_DMND_CONTENTS='합성 요청')
        parsed = parse_report(_row(result))[0]
        self.assertEqual(parsed['supplement_requested_at'], '2025-10-09 17:53:20')
        self.assertEqual(parsed['supplement_completed_at'], '2025-10-09 18:53:20')

    def test_worker_refuses_non_kst(self):
        import worker
        self._set('UTC')
        with self.assertRaises(SystemExit):
            worker.check_timezone()
        self._set('Asia/Seoul')
        worker.check_timezone()

    def test_parse_key(self):
        import worker
        from parse_report import registry_version
        self.assertEqual(worker.parse_key(), f"{worker.PARSER_VERSION}+map{worker.MAP_WORKER_VERSION}+reg{registry_version()}")
