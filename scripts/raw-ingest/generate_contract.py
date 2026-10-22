"""Deterministic synthetic wire vectors; raw serialization mirrors the pinned PC implementation."""
from pathlib import Path
import argparse
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
import os

# 파서 코드는 비공개 레포(Fentanest/safetyreport-community-parser)로 옮겼다. PARSER_REPO(그 checkout 경로)가 있으면
# 비교 DTO 를 파서의 build_payload 로 다시 만들고, 없으면 커밋된 vectors/wire.json 의 비교 DTO 를 그대로 쓴다.
_PARSER_REPO = os.environ.get('PARSER_REPO')
if _PARSER_REPO:
    sys.path.insert(0, str(Path(_PARSER_REPO).resolve()))
    from community_adapter import build_payload
else:
    build_payload = None

_args = argparse.ArgumentParser()
_args.add_argument('--out', type=Path, default=ROOT / 'contracts/community-ingest-v2',
                   help='output directory (check_contract.py regenerates into a temporary directory and compares)')
OUT = _args.parse_args().out
(OUT / 'vectors').mkdir(parents=True, exist_ok=True)
def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')
def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()
def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
def obj(props, required=None):
    return {'type': 'object', 'additionalProperties': False, 'properties': props, 'required': list(props) if required is None else required}
def ns(maximum):
    return {'type': ['string', 'null'], 'minLength': 1, 'maxLength': maximum}
def ni(maximum, minimum=0):
    return {'type': ['integer', 'null'], 'minimum': minimum, 'maximum': maximum}
HASH = {'type': 'string', 'pattern': '^[0-9a-f]{64}$'}
INSTANT = {'type': 'string', 'format': 'date-time', 'pattern': r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'}
supp = obj({'rating': ni(5, 1), 'rating_cause': ns(10000), 'survey_state': ns(80), 'photo_first_at': ns(80), 'photo_last_at': ns(80), 'photo_count': ni(1000000),
            'list': obj({'title': ns(1000), 'report_date': ns(80), 'status': ns(80), 'entry_value': ns(200), 'ssnpc_cd': ns(32), 'ssnpc_type': ns(32)})})
dump('supplement.schema.json', {'$schema': 'https://json-schema.org/draft/2020-12/schema', **supp})
v1 = json.loads((ROOT / 'contracts/community-ingest/envelope.schema.json').read_text())
event = v1['properties']['events']['items']
for k in ('payload', 'payload_sha256'):
    del event['properties'][k]
    event['required'].remove(k)
event['properties'].update({'raw': obj({'body': {'type': 'string', 'minLength': 1, 'maxLength': 1048576,
    'description': 'JSON 객체 텍스트(result 는 객체). 어느 객체에서든 중복 키, 짝 없는 UTF-16 surrogate(문자·이스케이프), U+0000 이 있으면 422 raw_invalid.'}, 'sha256': HASH, 'size': {'type': 'integer', 'minimum': 1, 'maximum': 1048576}, 'fetched_at': INSTANT, 'source': {'type': 'string', 'minLength': 1, 'maxLength': 80}}),
    'supplement': {'$ref': 'supplement.schema.json'}, 'supplement_sha256': HASH,
    'client_observation': {'$ref': '../community-ingest/observation.schema.json'}, 'client_observation_sha256': HASH})
event['required'] += ['raw', 'supplement', 'supplement_sha256']
event['dependentRequired'] = {'client_observation': ['client_observation_sha256'], 'client_observation_sha256': ['client_observation']}
event['properties']['event_type']['enum'] = ['completed_observation', 'location_supplement', 'reshare']
dump('event.schema.json', {'$schema': v1['$schema'], **event})
v1['$id'] = 'https://safemap.worklazy.net/contracts/community-ingest-v2/envelope.json'
v1['title'] = 'community-ingest v2 raw envelope'
v1['properties']['protocol'] = {'const': 2}
v1['properties']['contract'] = {'const': 'community-ingest-v2'}
v1['properties']['trigger']['enum'].append('raw_backfill')
# Match server/ingest/handler.ts exactly: POLICY regex and non-empty client/parser versions (1..40 code points).
v1['properties']['policy_version'] = {'type': 'string', 'pattern': r'^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]{1,3}$', 'maxLength': 40}
for k in ('client_version', 'parser_version'):
    v1['properties'][k] = {'type': 'string', 'minLength': 1, 'maxLength': 40}
v1['description'] = ('한 요청의 events 는 source_report_id 가 모두 달라야 한다(같은 신고의 이벤트는 앞 요청의 ACK 뒤에 다음 요청으로). '
                     '서버는 어기면 422/schema_invalid. 문자열에 짝 없는 UTF-16 surrogate 가 있으면 422 로 거절한다.')
v1['properties']['events']['items'] = {'$ref': 'event.schema.json'}
dump('envelope.schema.json', v1)
notice = obj({'level': {'enum': ['info', 'warning', 'required']}, 'message': {'type': 'string', 'minLength': 1, 'maxLength': 1000},
    'min_version': obj({'pc': ns(40), 'mobile': ns(40)}), 'url': obj({'pc': {'type': ['string', 'null'], 'format': 'uri'}, 'mobile': {'type': ['string', 'null'], 'format': 'uri'}}),
    'deadline': {'type': ['string', 'null'], 'format': 'date-time'}})
dump('client-notice.schema.json', {'$schema': v1['$schema'], **notice})
ack = json.loads((ROOT / 'contracts/community-ingest/ack.schema.json').read_text())
ack['$id'] = 'https://safemap.worklazy.net/contracts/community-ingest-v2/ack.json'
ack['title'] = 'community-ingest v2 ACK'
for shape in ack['oneOf']:
    shape['properties']['protocol'] = {'const': 2}
ack['oneOf'][0]['properties']['client_notice'] = {'oneOf': [{'$ref': 'client-notice.schema.json'}, {'type': 'null'}]}
r = ack['oneOf'][0]['properties']['results']['items']['properties']
r['status']['enum'].append('stored')
r['projection_status']['enum'].append('parse_pending')
dump('ack.schema.json', ack)

# Retain v1 vectors verbatim in their original directory. The new gate requires an active contributor for G1.
legacy_gate = json.loads((ROOT / 'contracts/community-ingest/vectors/gate.json').read_text())
for case in legacy_gate['cases']:
    if case['name'] == 'first_time_contributor_none_ok':
        case['expect'] = 'verification_required'
dump('legacy-gate-vectors.json', legacy_gate)

supplement = {k: None for k in supp['properties'] if k != 'list'}
supplement['list'] = {k: None for k in supp['properties']['list']['properties']}
raw = {'result': {'C_NO': 'SYNTHETIC01', 'C_NOW': 10, 'C_DATE': '2026-10-20 12:00:00', 'C_A_TITLE': '합성 신고', 'C_A_CONTENTS': '합성 비공개 본문',
    'answers': [{'C_MANAGER_TYPE_NM': '수용', 'C_MANAGE_CONTENTS': '합성 비공개 답변', 'C_DEPT_NAME': '합성기관'}], 'number': 1.0, 'unicode': '한글😀'}}
raw_body = json.dumps(raw, ensure_ascii=False, separators=(',', ':'))
if build_payload is not None:
    observation = build_payload({'processing_status': '수용', 'report_date': '2026-10-20', 'geocode': {}})
else:
    print('NOTE: PARSER_REPO 가 없어 커밋된 vectors/wire.json 의 client_observation 을 그대로 씁니다(파서 재계산 생략).', file=sys.stderr)
    observation = json.loads((ROOT / 'contracts/community-ingest-v2/vectors/wire.json').read_text())['envelope']['events'][0]['client_observation']
e = {'event_id': '10000000-0000-4000-8000-000000000001', 'event_type': 'completed_observation', 'source_system': 'safetyreport', 'source_report_id': 'SYNTHETIC01',
    'report_number': None, 'source_revision': 1, 'writer_epoch': 1, 'captured_at': '2026-10-21T00:00:00Z',
    'raw': {'body': raw_body, 'sha256': sha(raw_body), 'size': len(raw_body.encode()), 'fetched_at': '2026-10-21T00:00:00Z', 'source': 'raw_backfill'},
    'supplement': supplement, 'supplement_sha256': sha(canonical(supplement)), 'client_observation': observation, 'client_observation_sha256': sha(canonical(observation))}
env = {'protocol': 2, 'contract': 'community-ingest-v2', 'source_app': 'safetyreport', 'source_mode': 'server', 'connection_id': '20000000-0000-4000-8000-000000000001',
    'consent_grant_id': '30000000-0000-4000-8000-000000000001', 'policy_version': '2026-10-21.1', 'client_version': '3.6.0', 'parser_version': 'pc-parser-13', 'trigger': 'raw_backfill', 'events': [e]}
dump('vectors/wire.json', {'synthetic': True, 'envelope': env, 'raw_utf8_hex': raw_body.encode().hex(), 'supplement_canonical': canonical(supplement),
    'client_observation_canonical': canonical(observation), 'request_utf8_sha256': sha(json.dumps(env, ensure_ascii=False, separators=(',', ':'))),
    'raw_hash_cases': [{'body': s, 'sha256': sha(s), 'size': len(s.encode())} for s in ['{"result":{"a":1.0,"b":2}}', '{"result":{"b":2,"a":1}}', '{ "result": {} }', '{"result":{"문자":"한글😀"}}']]})

def manifest():
    paths = sorted(p for p in OUT.rglob('*') if p.is_file() and p.name != 'MANIFEST.sha256')
    (OUT / 'MANIFEST.sha256').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(OUT)}\n' for p in paths))
manifest()
print('PASS: generated schemas and synthetic UTF-8/hash vectors')
