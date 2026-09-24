import copy
import unittest

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
        'agencies': [{'key': 'a1', 'agency_name': '예시 기관', 'manager_name': None,
                      'completed_count': 1, 'outcomes': copy.deepcopy(OUTCOMES), 'fine_count': 0}],
        'managers': [{'key': 'm1', 'agency_name': '예시 기관', 'manager_name': '김하늘',
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


if __name__ == '__main__':
    unittest.main()
