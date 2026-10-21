"""Private parsing and public fact derivation. Never logs report contents."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import unicodedata
from community_adapter import build_adapter_input, build_payload, canonical_json, payload_sha256, ELIGIBLE
from services.parser import parse_json_details

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / 'shared/agency-region-registry'
spec = importlib.util.spec_from_file_location('registry_resolve', REGISTRY / 'resolvers/resolve.py')
resolve = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = resolve
spec.loader.exec_module(resolve)
_snapshot = None
SIDO = {'서울특별시':'서울','서울시':'서울','부산광역시':'부산','부산시':'부산','대구광역시':'대구','대구시':'대구',
'인천광역시':'인천','인천시':'인천','광주광역시':'광주','광주시':'광주','대전광역시':'대전','대전시':'대전',
'울산광역시':'울산','울산시':'울산','세종특별자치시':'세종','세종시':'세종','경기도':'경기','강원도':'강원',
'강원특별자치도':'강원','충청북도':'충북','충청남도':'충남','전라북도':'전북','전북특별자치도':'전북',
'전라남도':'전남','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주','제주도':'제주'}
DETAIL = {'processing_status':'처리상태','penalty_amount':'범칙금_과태료','response_date':'답변일','processing_agency':'처리기관',
'processing_agency_code':'처리기관코드','person_in_charge':'담당자','car_number':'차량번호','violation_location':'위반장소',
'penalty_points':'벌점','violation_law':'위반법규','occurrence_time':'발생시각'}

def derive_fact(p):
    global _snapshot
    if _snapshot is None:
        _snapshot = resolve.Snapshot.load(REGISTRY)
    r = resolve.resolve_current_agency(p.get('source_agency_code'),p['agency_name'],_snapshot)
    def short(s):
        return hashlib.sha256(unicodedata.normalize('NFC',s).encode()).hexdigest()[:24]
    a = r['agency_stat_key'] if r['institution_id'] is not None else 'a1:'+short(p['agency_name']) if p['agency_name'] else None
    m = 'm1:'+short((a or 'agency-unknown')+'|'+p['manager_name']) if p['manager_name'] else None
    loc = p['location']; located=loc['source']=='geocode'
    tok=(p['address'] or '').split(); region=(SIDO.get(tok[0],tok[0])+' '+tok[1])[:24] if len(tok)>1 else None
    fine=p.get('fine_estimate') or {}
    return dict(public_state='completed' if p['status'] in ELIGIBLE else 'not_completed',
        report_date=p['report_date'],completed_date=p['completed_date'],category=p['category'],status=p['status'],disposition=p['disposition'],
        amount_kind=p['amount']['kind'],amount_confirmed_won=p['amount']['confirmed_won'],penalty_points=p['amount']['penalty_points'],vehicle_raw=p['vehicle_raw'],
        lat=float(loc['lat']) if located else None,lng=float(loc['lng']) if located else None,
        lat_text=loc['lat'] if located else None,lng_text=loc['lng'] if located else None,coord_source=loc['source'],address=p['address'],region_code=region,
        point_key=f"v1:{loc['lat']},{loc['lng']}" if located else None,agency_key=a,agency_name=p['agency_name'],
        agency_current_name=resolve.display_agency(p['agency_name'],r) or p['agency_name'],manager_key=m,manager_name=p['manager_name'],
        violation_law=p.get('violation_law'),source_agency_code=p.get('source_agency_code'),agency_registry_version=_snapshot.registry_version,
        rating=p.get('rating'),fine_estimate_won=fine.get('won'),fine_estimate_rule=fine.get('rule'),fine_estimate_rule_version=fine.get('rule_version'))

def registry_version():
    """Agency registry snapshot version; part of the worker's reparse key."""
    global _snapshot
    if _snapshot is None:
        _snapshot = resolve.Snapshot.load(REGISTRY)
    return _snapshot.registry_version

def _official_geo(lat, lng):
    """PC services/geocode_service.official_geo_payload (1a67d01): finite, inside Korea, else no coordinates."""
    try:
        lat, lng = float(lat), float(lng)
        valid = math.isfinite(lat) and math.isfinite(lng) and 32 <= lat <= 39.5 and 124 <= lng <= 132
    except (TypeError, ValueError):
        valid = False
    return {'위도': lat if valid else None, '경도': lng if valid else None, '지오코딩상태': 'ok' if valid else ''}

def parse_report(row):
    """Raw detail + client supplement -> (private parsed columns, PC-identical DTO, derived fact, client diff or None).

    The DTO inputs are exactly PC core/storage/reports_repo._community_capture_for (1a67d01): parser title fields
    (rating replaced by the client's enriched rating, which is supplement.rating), parser entry_value/ssnpc pair,
    supplement photo times. No list fallbacks: an empty parser value stays empty exactly as on the PC.
    """
    body=row['raw_text']
    if hashlib.sha256(body.encode()).hexdigest()!=row['raw_sha256']:
        raise ValueError('raw_hash_mismatch')
    raw=json.loads(body)
    result=raw['result']
    if not isinstance(result,dict) or any(k in result for k in ('C_NAME','C_EMAIL','C_PHONE','C_PHONE2','C_ID')):
        raise ValueError('raw_invalid')
    d=parse_json_details(result); s=row['supplement']; listing=s['list']; title=d.pop('title_fields'); sup=d.pop('supplement_summary')
    # PC: title_fields['별점'] after satisfaction enrichment; the parser's STSFDG_SCORE value is not used on its own.
    title['별점']=s['rating']
    # PC report_name = title 신고명 or the stored row's 신고명 (the client's list title is that stored value).
    report_name=title.get('신고명') or listing['title']
    detail={ko:d.get(en) for en,ko in DETAIL.items()}
    geo=_official_geo(d.get('violation_latitude'),d.get('violation_longitude'))
    inp=build_adapter_input(detail,title,entry_value=d.get('entry_value'),geo=geo,
        ssnpc_cd=d.get('ssnpc_cd'),ssnpc_type=d.get('ssnpc_type'),report_name=report_name,
        photo_first_at=s['photo_first_at'],photo_last_at=s['photo_last_at'])
    payload=build_payload(inp)
    if payload['status'] not in ELIGIBLE: raise ValueError('non_final_not_accepted')
    # Stored columns are the same values that produced the fact.
    parsed={**d,'entry_value':inp['entry_value'],'ssnpc_cd':inp['ssnpc_cd'],'ssnpc_type':inp['ssnpc_type'],
        'report_number':title.get('신고번호') or None,'report_title':title.get('신고명') or None,'report_date':title.get('신고일') or None,
        'list_status':title.get('상태') or None,'survey_state':s['survey_state'] or title.get('만족도조사여부'),'rating':s['rating'],
        'rating_cause':s['rating_cause'],'photo_first_at':s['photo_first_at'],'photo_last_at':s['photo_last_at'],'photo_count':s['photo_count'],
        'category':payload['category'],'supplement_count':sup.get('count'),'supplement_is_open':sup.get('is_open'),
        'supplement_requester':sup.get('requester'),'supplement_requested_at':sup.get('requested_at'),
        'supplement_completed_at':sup.get('completed_at'),'supplement_request_text':sup.get('request_text'),
        'supplement_reporter_opinion':sup.get('reporter_opinion'),'supplement_requester_phone':result.get('SPLMNT_RQSTR_TELNO')}
    client=row.get('client_observation')
    diffs=None
    if client is not None:
        diffs={}
        for k in sorted(client.keys()|payload.keys()):
            if client.get(k)!=payload.get(k) or (k in client)!=(k in payload):
                diffs[k]={'client':client.get(k),'server':payload.get(k)}
    return parsed,payload,derive_fact(payload),diffs

if __name__=='__main__':
    # Offline equivalence harness; only synthetic vectors may be supplied here.
    print(json.dumps([derive_fact(p) for p in json.load(sys.stdin)],ensure_ascii=False))
