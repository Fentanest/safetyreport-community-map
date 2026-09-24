"""Executable specification helpers (not an upstream ingestion implementation).
All test inputs are synthetic. Public output must not contain identity/plate keys.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import math
import re
import unicodedata
from typing import Any, Iterable

KST = timezone(timedelta(hours=9))
REGIONS = {
    '서울특별시':'서울','부산광역시':'부산','대구광역시':'대구','인천광역시':'인천',
    '광주광역시':'광주','대전광역시':'대전','울산광역시':'울산','세종특별자치시':'세종',
    '경기도':'경기','강원특별자치도':'강원','강원도':'강원','충청북도':'충북','충청남도':'충남',
    '전북특별자치도':'전북','전라북도':'전북','전라남도':'전남','경상북도':'경북','경상남도':'경남',
    '제주특별자치도':'제주','제주도':'제주',
    **{v:v for v in ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주']}
}
BODY_RE = re.compile(r'^[0-9]{2,3}[가-힣][0-9]{4}$')


def checked_count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError('count must be a non-negative integer')
    return value


def parse_plate(raw: Any) -> tuple[str, str] | None:
    """Return private canonical identity and prefix-free display body; fail closed."""
    if not isinstance(raw, str) or len(raw) > 64:
        return None
    text = re.sub(r'[\s-]', '', unicodedata.normalize('NFKC', raw))
    region = ''
    for prefix in sorted(REGIONS, key=len, reverse=True):
        if text.startswith(prefix):
            region, text = REGIONS[prefix], text[len(prefix):]
            break
    if not BODY_RE.fullmatch(text):
        return None
    return region + text, text


def mask_plate(raw: Any) -> str:
    parsed = parse_plate(raw)
    if parsed is None:
        return '번호 확인 불가'
    chars = list(parsed[1])
    for index in (1, 3, 5):
        chars[index] = '*'
    return ''.join(chars)


def percent(numerator: int, denominator: int) -> float | None:
    checked_count(numerator); checked_count(denominator)
    if numerator > denominator:
        raise ValueError('numerator exceeds denominator')
    return None if denominator == 0 else numerator * 100.0 / denominator


def growth(current: int, previous: int) -> dict[str, Any]:
    checked_count(current); checked_count(previous)
    if previous == 0:
        return {'delta':current-previous, 'percent':None,
                'reason':'new' if current > 0 else 'no_baseline'}
    return {'delta':current-previous, 'percent':(current-previous)*100.0/previous, 'reason':None}


def outcome_rates(accepted: int, partial: int, rejected: int) -> dict[str, Any]:
    for n in (accepted,partial,rejected): checked_count(n)
    d=accepted+partial+rejected
    return {'denominator':d, 'accepted':percent(accepted,d),
            'partial':percent(partial,d), 'rejected':percent(rejected,d),
            'accepted_including_partial':percent(accepted+partial,d)}


def kst_day(value: Any) -> date | None:
    if value is None: return None
    if not isinstance(value,str): raise ValueError('date must be ISO string or null')
    if len(value)==10: return date.fromisoformat(value)
    dt=datetime.fromisoformat(value.replace('Z','+00:00'))
    if dt.tzinfo is None: raise ValueError('timestamp must include timezone')
    return dt.astimezone(KST).date()


def in_window(value: Any, start: str, end: str) -> bool:
    lo,hi=date.fromisoformat(start),date.fromisoformat(end)
    if hi < lo: raise ValueError('reversed date range')
    day=kst_day(value)
    return day is not None and lo <= day <= hi


def monthly_counts(records: Iterable[dict[str,Any]], *, basis: str,
                   disposition: str | None=None) -> dict[str,int]:
    if basis not in ('report_date','completed_date'):
        raise ValueError('unknown date basis')
    out: dict[str,int]=defaultdict(int)
    for r in records:
        if disposition is not None and r.get('disposition') != disposition: continue
        d=kst_day(r.get(basis))
        if d is not None:
            n=checked_count(r.get('count',1))
            out[d.strftime('%Y-%m')]+=n
    return dict(sorted(out.items()))


def exact_vehicle_top5(records: Iterable[dict[str,Any]], *, start: str,
                       end: str, region: str | None=None) -> dict[str,Any]:
    """Private aggregation then public projection. No raw/global identifier returned."""
    if date.fromisoformat(end) < date.fromisoformat(start):
        raise ValueError('reversed date range')
    counts: dict[str,int]=defaultdict(int)
    total=0; identifiable=0
    for r in records:
        if not in_window(r.get('report_date'),start,end): continue
        if region is not None and r.get('region') != region: continue
        n=checked_count(r.get('count',1)); total+=n
        p=parse_plate(r.get('vehicle'))
        if p is not None and n > 0:
            counts[p[0]]+=n; identifiable+=n
    ranked=sorted(counts.items(),key=lambda p:(-p[1],p[0]))[:5]
    return {'total_scope_reports':total, 'identifiable_reports':identifiable,
            'items':[{'rank':i,'rank_item_id':f'r{i}', 'masked_plate':mask_plate(raw),
                      'report_count':count,'percentage':percent(count,total)}
                     for i,(raw,count) in enumerate(ranked,1)]}
