import copy
import unittest

import os
from unittest import mock

from scripts import export_snapshot
from scripts.export_snapshot import validate_dashboard


SCOPE = {'start': '2026-01-01', 'end': '2026-02-28', 'category': 'all',
         'region_code': None, 'agency_key': None, 'manager_key': None, 'bbox': None}
OUTCOMES = {'accepted': 1, 'partial': 0, 'rejected': 0, 'result_known': 1, 'result_unknown': 0}


def metric(value, basis):
    return {'value': value, 'basis': basis, 'denominator': None, 'eligible': value,
            'missing': 0, 'previous': None, 'delta': None, 'delta_percent': None,
            'delta_reason': None}


def dashboard():
    return {
        'schema_version': 2, 'dataset_version': 'v2-test', 'sample': False,
        'scope': copy.deepcopy(SCOPE),
        'overview': {
            'report_count': metric(1, 'report_date'),
            'completed_count': metric(1, 'completed_date'),
            'accepted_including_partial': metric(100, 'completed_date') | {'denominator': 1, 'numerator': 1, 'unit': 'percent'},
            'fine_count': metric(0, 'completed_date'),
            'point_count': metric(1, 'report_date'),
            'contributor_count': metric(1, 'report_date'), 'outcomes': copy.deepcopy(OUTCOMES),
        },
        'points': [{'key': 'p1', 'lat': 37.566535, 'lng': 126.9779692,
                    'address': '예시 지점', 'region_code': '11', 'report_count': 1,
                    'completed_count': 1, 'outcomes': copy.deepcopy(OUTCOMES), 'fine_count': 0}],
        'monthly': [{'month': '2026-01', 'report_count': 1, 'completed_count': 0,
                     'fine_count': 0, 'outcomes': copy.deepcopy(OUTCOMES), 'partial': False,
                     'coverage_note': None}],
        'agencies': [{'key': 'a1', 'agency_key': 'a1', 'manager_key': None, 'agency_name': '예시 기관', 'manager_name': None,
                      'completed_count': 1, 'outcomes': copy.deepcopy(OUTCOMES), 'fine_count': 0}],
        'managers': [{'key': 'm1', 'agency_key': 'a1', 'manager_key': 'm1', 'agency_name': '예시 기관', 'manager_name': '김하늘',
                      'completed_count': 1, 'outcomes': copy.deepcopy(OUTCOMES), 'fine_count': 0}],
        'vehicles': [{'rank': 1, 'rank_item_id': 'r1', 'masked_plate': '1*가*4*6',
                      'report_count': 1, 'percentage': 100}],
        'vehicle_total_scope_reports': 1, 'vehicle_identifiable_reports': 1,
    }


class ExportProjectionTests(unittest.TestCase):
    def test_safe_one_record_is_allowed(self):
        self.assertEqual(validate_dashboard(dashboard(), SCOPE, 'v2-test')['managers'][0]['manager_name'], '김하늘')

    def test_private_or_unknown_fields_are_rejected(self):
        data = dashboard()
        data['points'][0]['contributor_id'] = 'private-account'
        with self.assertRaises(ValueError):
            validate_dashboard(data, SCOPE, 'v2-test')
        data = dashboard()
        data['unexpected'] = 1
        with self.assertRaises(ValueError):
            validate_dashboard(data, SCOPE, 'v2-test')

    def test_sample_and_unmasked_plate_are_rejected(self):
        data = dashboard()
        data['sample'] = True
        with self.assertRaises(ValueError):
            validate_dashboard(data, SCOPE, 'v2-test')
        data = dashboard()
        data['vehicles'][0]['masked_plate'] = '서울12가3456'
        with self.assertRaises(ValueError):
            validate_dashboard(data, SCOPE, 'v2-test')

    def test_live_dashboard_fields_regions_and_location_missing_are_allowed(self):
        data = dashboard()
        data['location_missing'] = 2
        row = {'report_count': 1, 'completed_count': 1, 'outcomes': copy.deepcopy(OUTCOMES), 'fine_count': 0}
        data['regions'] = [
            {'level': 'sido', 'region_code': '11', 'name': '서울특별시', 'sido_code': None, **row},
            {'level': 'sgg', 'region_code': '11140', 'name': '서울 중구', 'sido_code': '11', **row,
             'duration': {'count': 1, 'median_days': 3, 'mean_days': 3},
             'fine_amount': {'fine_count': 0, 'confirmed_count': 0, 'sum_won': None, 'mean_won': None}},
            {'level': 'unknown', 'region_code': None, 'name': '지역 미확인', 'sido_code': None, **row},
        ]
        self.assertEqual(validate_dashboard(data, SCOPE, 'v2-test')['regions'][1]['region_code'], '11140')

    def test_region_rows_must_use_official_codes(self):
        row = {'report_count': 1, 'completed_count': 1, 'outcomes': copy.deepcopy(OUTCOMES), 'fine_count': 0}
        for bad in [
            {'level': 'sgg', 'region_code': '서울 중구', 'name': '서울 중구', 'sido_code': '11'},  # legacy display key
            {'level': 'sido', 'region_code': '11140', 'name': 'x', 'sido_code': None},           # level/code mismatch
            {'level': 'unknown', 'region_code': '11', 'name': 'x', 'sido_code': None},
            {'level': 'city', 'region_code': '11', 'name': 'x', 'sido_code': None},
        ]:
            data = dashboard()
            data['regions'] = [{**bad, **row}]
            with self.assertRaises(ValueError):
                validate_dashboard(data, SCOPE, 'v2-test')

    def test_personal_comparison_fields_never_enter_a_snapshot(self):
        for field in ['mine', 'viewer', 'my_points']:
            data = dashboard()
            data[field] = {}
            with self.assertRaises(ValueError):
                validate_dashboard(data, SCOPE, 'v2-test')
        data = dashboard()
        data['regions'] = [{'region_code': '서울 중구', 'report_count': 1, 'completed_count': 1,
                            'outcomes': copy.deepcopy(OUTCOMES), 'fine_count': 0, 'mine': {'report_count': 1}}]
        with self.assertRaises(ValueError):
            validate_dashboard(data, SCOPE, 'v2-test')

    def test_not_ready_projection_never_writes_a_snapshot(self):
        meta = {'schema_version': 2, 'dataset_version': 'v2-test', 'sample': False, 'source_updated_at': None,
                'generated_at': '2026-09-27T00:00:00Z', 'published_at': None, 'data_min': None, 'data_max': None,
                'coverage_note': 'x', 'dedupe_policy_version': 'x',
                'capabilities': {'daily_report_dates': {'status': 'missing', 'reason': 'not ready', 'coverage': None}}}
        env = {'PUBLIC_ANALYTICS_URL': 'https://example.invalid/functions/v1'}
        with mock.patch.object(export_snapshot, 'get_json', return_value=meta) as get, \
             mock.patch.object(export_snapshot, 'atomic_json') as write:
            with mock.patch.dict(os.environ, env, clear=False):
                os.environ.pop('SNAPSHOT_ALLOW_NOT_READY', None)
                with self.assertRaises(SystemExit):
                    export_snapshot.main()
            with mock.patch.dict(os.environ, env | {'SNAPSHOT_ALLOW_NOT_READY': '1'}):
                self.assertEqual(export_snapshot.main(), 0)
            write.assert_not_called()
            self.assertEqual(get.call_count, 2)  # meta only, never the dashboard


if __name__ == '__main__':
    unittest.main()
