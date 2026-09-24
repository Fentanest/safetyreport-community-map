#!/usr/bin/env python3
"""Export a small, already-public nationwide dashboard snapshot from the public API.

No database or administrator credential is accepted. A failed export leaves existing files alone.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

VERSION = re.compile(r'^[A-Za-z0-9._-]{1,120}$')
MASKED = re.compile(r'^[0-9]\*[0-9가-힣]\*[0-9]\*[0-9]{1,2}$')
FORBIDDEN = {'contributor_id', 'snapshot_id', 'vehicle_raw', 'vehicle_canonical', 'raw_plate',
             'vehicle_hash', 'email', 'phone', 'access_token', 'refresh_token', 'google_sub'}


def exact_keys(value: object, keys: set[str], optional: set[str] | None = None) -> dict:
    if not isinstance(value, dict):
        raise ValueError('expected object')
    optional = optional or set()
    if not keys <= value.keys() or value.keys() - keys - optional:
        raise ValueError('unknown or missing public DTO field')
    return value


def validate_public(value: object) -> None:
    if isinstance(value, dict):
        if FORBIDDEN & value.keys():
            raise ValueError('private field in public DTO')
        for nested in value.values():
            validate_public(nested)
    elif isinstance(value, list):
        for nested in value:
            validate_public(nested)


def validate_dashboard(value: object, expected_scope: dict, version: str) -> dict:
    top = exact_keys(value, {'schema_version', 'dataset_version', 'sample', 'scope', 'overview',
                             'points', 'monthly', 'agencies', 'managers', 'vehicles',
                             'vehicle_total_scope_reports', 'vehicle_identifiable_reports'})
    if top['schema_version'] != 2 or top['sample'] is not False or top['dataset_version'] != version:
        raise ValueError('snapshot version or data mode mismatch')
    if top['scope'] != expected_scope:
        raise ValueError('snapshot scope mismatch')
    validate_public(top)
    overview = exact_keys(top['overview'], {'report_count', 'completed_count', 'accepted_including_partial',
                                           'fine_count', 'point_count', 'contributor_count', 'outcomes'})
    metric_keys = {'value', 'basis', 'denominator', 'eligible', 'missing', 'previous', 'delta',
                   'delta_percent', 'delta_reason'}
    for name in ['report_count', 'completed_count', 'fine_count', 'point_count', 'contributor_count']:
        exact_keys(overview[name], metric_keys, {'note'})
    exact_keys(overview['accepted_including_partial'], metric_keys | {'numerator', 'unit'}, {'note'})
    outcome_keys = {'accepted', 'partial', 'rejected', 'result_known', 'result_unknown'}
    exact_keys(overview['outcomes'], outcome_keys)
    for point in top['points']:
        exact_keys(point, {'key', 'lat', 'lng', 'address', 'region_code', 'report_count',
                           'completed_count', 'outcomes', 'fine_count'})
        if not 32 <= point['lat'] <= 39.5 or not 124 <= point['lng'] <= 132:
            raise ValueError('invalid public coordinate')
        if point['outcomes'] is not None:
            exact_keys(point['outcomes'], outcome_keys)
    if len(top['points']) > 1000:
        raise ValueError('map budget exceeded')
    for month in top['monthly']:
        exact_keys(month, {'month', 'report_count', 'completed_count', 'fine_count',
                           'outcomes', 'partial', 'coverage_note'})
        if month['outcomes'] is not None:
            exact_keys(month['outcomes'], outcome_keys)
    for name in ['agencies', 'managers']:
        if len(top[name]) > 100:
            raise ValueError('entity page budget exceeded')
        for entity in top[name]:
            exact_keys(entity, {'key', 'agency_name', 'manager_name', 'completed_count', 'outcomes', 'fine_count'})
            exact_keys(entity['outcomes'], outcome_keys)
    if len(top['vehicles']) > 5:
        raise ValueError('vehicle limit exceeded')
    for item in top['vehicles']:
        exact_keys(item, {'rank', 'rank_item_id', 'masked_plate', 'report_count', 'percentage'})
        if not MASKED.fullmatch(item['masked_plate']):
            raise ValueError('invalid masked vehicle')
    return top


def recent_twelve_months() -> dict:
    today = dt.datetime.now(ZoneInfo('Asia/Seoul')).date()
    try:
        prior = today.replace(year=today.year - 1)
    except ValueError:
        prior = today.replace(year=today.year - 1, day=28)
    start = prior + dt.timedelta(days=1)
    return {'start': start.isoformat(), 'end': today.isoformat(), 'category': 'all',
            'region_code': None, 'agency_key': None, 'manager_key': None, 'bbox': None}


def get_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={'Accept': 'application/json'}, method='GET')
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read(8_000_001)
        if len(raw) > 8_000_000:
            raise ValueError('public API response too large')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('public API response is not an object')
    return value


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as file:
        json.dump(value, file, ensure_ascii=False, separators=(',', ':'))
        temp = Path(file.name)
    temp.replace(path)


def main() -> int:
    base = os.environ.get('PUBLIC_ANALYTICS_URL', '').rstrip('/')
    if not base.startswith('https://'):
        raise SystemExit('PUBLIC_ANALYTICS_URL must be an HTTPS public read API base')
    scope = recent_twelve_months()
    meta = get_json(base + '/public-analytics/meta')
    exact_keys(meta, {'schema_version', 'dataset_version', 'sample', 'source_updated_at',
                      'generated_at', 'published_at', 'data_min', 'data_max', 'coverage_note',
                      'dedupe_policy_version', 'capabilities'})
    validate_public(meta)
    version = meta['dataset_version']
    if meta['schema_version'] != 2 or meta['sample'] is not False or not isinstance(version, str) or not VERSION.fullmatch(version) or not isinstance(meta['generated_at'], str):
        raise SystemExit('public meta is not a live versioned dataset')
    if meta['capabilities'].get('daily_report_dates', {}).get('status') != 'supported':
        raise SystemExit('v2 daily facts are unavailable; refusing a partial snapshot')
    params = urllib.parse.urlencode({k: v for k, v in scope.items() if v is not None} | {'expected_version': version})
    dashboard = validate_dashboard(get_json(base + '/public-analytics/dashboard?' + params), scope, version)
    out = Path(os.environ.get('PUBLIC_SNAPSHOT_DIR', 'public/data'))
    atomic_json(out / version / 'dashboard.json', dashboard)
    atomic_json(out / 'manifest.json', {'schema_version': 2, 'dataset_version': version,
                                        'scope': scope, 'generated_at': meta['generated_at']})
    print(json.dumps({'dataset_version': version, 'scope': scope, 'output': str(out)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
