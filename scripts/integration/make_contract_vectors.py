#!/usr/bin/env python3
"""Write contracts/community-ingest/vectors/*.json from HAND-WRITTEN expected values.

Expected payloads, eligibility and schedule answers below are written by hand from observation.md /
schedule.md. This script only serialises them (canonical JSON + sha256) so the three language
implementations are checked against the specification, not against each other.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "contracts" / "community-ingest"


def canonical(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(obj) -> str:
    return hashlib.sha256(canonical(obj).encode("utf-8")).hexdigest()


def base_input(**kw):
    value = {
        "processing_status": "수용", "penalty_amount": "과태료: 40,000원", "report_date": "2026-09-01",
        "response_date": "2026-09-10", "processing_agency": "서울특별시 중구청", "person_in_charge": "홍길동",
        "car_number": "12가3456", "violation_location": "서울특별시 중구 세종대로 110",
        "entry_value": "불법주정차신고", "penalty_points": "", "geocode": {"status": "ok", "lat": 37.5662952, "lng": 126.9779451},
    }
    value.update(kw)
    return value


def payload(**kw):
    value = {
        "address": "서울특별시 중구 세종대로 110", "agency_name": "서울특별시 중구청",
        "amount": {"confirmed_won": 40000, "kind": "fine", "penalty_points": None}, "category": "parking",
        "completed_date": "2026-09-10", "disposition": "fine",
        "location": {"lat": "37.5662952", "lng": "126.9779451", "source": "geocode"},
        "manager_name": "홍길동", "report_date": "2026-09-01", "status": "accepted", "status_raw": "수용",
        "vehicle_raw": "12가3456",
    }
    value.update(kw)
    return value


NO_LOC = {"lat": None, "lng": None, "source": "none"}
UNKNOWN_AMOUNT = {"confirmed_won": None, "kind": "unknown", "penalty_points": None}

OBS = [
    ("accepted_fine", base_input(), payload(), True),
    ("partial_penalty_traffic", base_input(processing_status="일부수용", penalty_amount="범칙금: 60,000원",
        penalty_points="벌점: 15점", entry_value="자동차·교통위반 > 신호위반"),
        payload(status="partial", status_raw="일부수용", disposition="penalty",
                amount={"confirmed_won": 60000, "kind": "penalty", "penalty_points": 15}, category="traffic"), True),
    ("rejected_none", base_input(processing_status="불수용", penalty_amount=""),
        payload(status="rejected", status_raw="불수용", disposition="none", amount=UNKNOWN_AMOUNT), True),
    ("answer_done_unknown", base_input(processing_status="답변완료", penalty_amount="미확인"),
        payload(status="completed_unknown", status_raw="답변완료", disposition="unknown", amount=UNKNOWN_AMOUNT), True),
    ("other_answer_is_completed_unknown", base_input(processing_status="기타", penalty_amount="경고"),
        payload(status="completed_unknown", status_raw="기타", disposition="warning", amount=UNKNOWN_AMOUNT), True),
    ("fine_keyword_without_amount", base_input(penalty_amount="과태료"),
        payload(amount={"confirmed_won": None, "kind": "fine", "penalty_points": None}), True),
    ("zero_amount_is_not_null", base_input(penalty_amount="과태료: 0원"),
        payload(amount={"confirmed_won": 0, "kind": "fine", "penalty_points": None}), True),
    ("withdrawn_not_eligible", base_input(processing_status="취하", penalty_amount="", response_date="2026-09-05"),
        payload(status="withdrawn", status_raw="취하", disposition="unknown", amount=UNKNOWN_AMOUNT,
                completed_date=None), False),
    ("transferred_not_eligible", base_input(processing_status="이송", penalty_amount=""),
        payload(status="transferred", status_raw="이송", disposition="unknown", amount=UNKNOWN_AMOUNT,
                completed_date=None), False),
    ("supplement_not_eligible", base_input(processing_status="보완요청", penalty_amount="", response_date=""),
        payload(status="supplement", status_raw="보완요청", disposition="unknown", amount=UNKNOWN_AMOUNT,
                completed_date=None), False),
    ("processing_not_eligible", base_input(processing_status="처리중", penalty_amount="", response_date=""),
        payload(status="processing", status_raw="처리중", disposition="unknown", amount=UNKNOWN_AMOUNT,
                completed_date=None), False),
    ("unknown_status_is_other", base_input(processing_status="  ", penalty_amount=""),
        payload(status="other", status_raw=None, disposition="unknown", amount=UNKNOWN_AMOUNT,
                completed_date=None), False),
    ("missing_answer_date_stays_null", base_input(response_date=""), payload(completed_date=None), True),
    ("date_formats", base_input(report_date="2026.02.28 13:05", response_date="20260301"),
        payload(report_date="2026-02-28", completed_date="2026-03-01"), True),
    ("invalid_calendar_date", base_input(report_date="2026-02-30", response_date="2026-13-01"),
        payload(report_date=None, completed_date=None), True),
    ("geocode_pending_no_location", base_input(geocode={"status": "pending", "lat": None, "lng": None}),
        payload(location=NO_LOC), True),
    ("geocode_outside_korea", base_input(geocode={"status": "ok", "lat": 40.1, "lng": 127.0}),
        payload(location=NO_LOC), True),
    ("geocode_string_numbers", base_input(geocode={"status": "ok", "lat": "35.1795543", "lng": "129.0756416"}),
        payload(location={"lat": "35.1795543", "lng": "129.0756416", "source": "geocode"}), True),
    ("geocode_long_decimals_kept", base_input(geocode={"status": "ok", "lat": "37.123456789012", "lng": 127.02861010903201}),
        payload(location={"lat": "37.123456789012", "lng": "127.02861010903202", "source": "geocode"}), True),
    ("geocode_integer_valued_double", base_input(geocode={"status": "ok", "lat": 37, "lng": "127"}),
        payload(location={"lat": "37.0", "lng": "127.0", "source": "geocode"}), True),
    ("penalty_points_only_text", base_input(processing_status="수용", penalty_amount="범칙금: 30,000원", penalty_points="벌점: 0점",
        entry_value="자동차·교통위반"),
        payload(disposition="penalty", amount={"confirmed_won": 30000, "kind": "penalty", "penalty_points": 0}, category="traffic"), True),
    ("whitespace_and_controls_cleaned", base_input(processing_agency="  부산광역시\t 해운대구청\n", person_in_charge="\u0007김  철수 ",
        car_number=" 서울12가 3456 ", violation_location=""),
        payload(agency_name="부산광역시 해운대구청", manager_name="김 철수", vehicle_raw="서울12가 3456", address=None), True),
    ("empty_optional_fields_are_null", base_input(processing_agency="", person_in_charge=None, car_number="",
        entry_value="안전신문고 > 기타"),
        payload(agency_name=None, manager_name=None, vehicle_raw=None, category="other"), True),
    ("long_text_truncated_by_code_point", base_input(person_in_charge="가" * 170),
        payload(manager_name="가" * 160), True),
    ("quotes_and_backslash", base_input(violation_location='경기도 "수원시" 팔달구 \\ 1'),
        payload(address='경기도 "수원시" 팔달구 \\ 1'), True),
]

EVENTS = [
    {"name": "first_eligible_creates_completed", "prev": None, "observation": "accepted_fine",
     "expect": "completed_observation"},
    {"name": "same_content_again_creates_nothing", "prev": {"observation": "accepted_fine"},
     "observation": "accepted_fine", "expect": None},
    {"name": "changed_eligible_creates_completed", "prev": {"observation": "accepted_fine"},
     "observation": "partial_penalty_traffic", "expect": "completed_observation"},
    {"name": "withdrawn_after_shared_creates_correction", "prev": {"observation": "accepted_fine"},
     "observation": "withdrawn_not_eligible", "expect": "status_correction"},
    {"name": "not_eligible_never_shared_creates_nothing", "prev": None,
     "observation": "processing_not_eligible", "expect": None},
    {"name": "not_eligible_after_correction_creates_nothing", "prev": {"observation": "withdrawn_not_eligible"},
     "observation": "transferred_not_eligible", "expect": None},
    {"name": "eligible_again_after_correction", "prev": {"observation": "withdrawn_not_eligible"},
     "observation": "accepted_fine", "expect": "completed_observation"},
]


def main():
    by_name = {}
    cases = []
    for name, inp, exp, eligible in OBS:
        by_name[name] = exp
        cases.append({"name": name, "input": inp, "expected_payload": exp, "eligible": eligible,
                      "canonical_json": canonical(exp), "payload_sha256": sha(exp)})
    for ev in EVENTS:
        if ev["prev"]:
            prev_payload = by_name[ev["prev"]["observation"]]
            ev["prev"] = {"payload_sha256": sha(prev_payload),
                          "eligible": prev_payload["status"] in {"accepted", "partial", "rejected", "completed_unknown"}}
    (ROOT / "vectors").mkdir(parents=True, exist_ok=True)
    (ROOT / "vectors" / "observations.json").write_text(json.dumps(
        {"contract": "observation-v1", "cases": cases, "event_decisions": EVENTS},
        ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    canon = [
        {"name": "sorted_nested", "value": {"b": 1, "a": {"d": None, "c": "x"}}},
        {"name": "korean_utf8_unescaped", "value": {"k": "서울 중구"}},
        {"name": "escapes_quote_and_backslash", "value": {"k": 'a"b\\c'}},
        {"name": "negative_and_zero", "value": {"n": -5, "z": 0}},
        {"name": "empty_object", "value": {}},
    ]
    for c in canon:
        c["canonical_json"] = canonical(c["value"])
        c["sha256"] = sha(c["value"])
    (ROOT / "vectors" / "canonical-json.json").write_text(json.dumps(
        {"cases": canon}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
