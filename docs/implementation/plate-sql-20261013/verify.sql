-- Operator-only rehearsal: applies the candidate and verifies shared fixtures, then ROLLBACK.
-- Run in psql with ON_ERROR_STOP: psql -X -v ON_ERROR_STOP=1 -f verify.sql
-- No output includes real stored plates. No fact rows are read or rewritten.
begin;
-- Read-time normalization parity with server/plate.ts; no stored fact is rewritten.
-- New helper accepts general/motorcycle tokens. screen_plate remains the public,
-- safely maskable general-plate projection (the same boundary as parsePlate).
-- CLI migration creation was blocked by its home telemetry write in this sandbox.
set local lock_timeout='3s';

create or replace function private.screen_normalize_plate(raw text) returns text
language plpgsql immutable set search_path='' as $$
declare
 t text; hit text[]; candidate text; found text; pos integer:=1; first_pos integer; end_pos integer;
 names constant jsonb := '{"서울특별시":"서울","부산광역시":"부산","대구광역시":"대구","인천광역시":"인천","광주광역시":"광주","대전광역시":"대전","울산광역시":"울산","세종특별자치시":"세종","경기도":"경기","강원특별자치도":"강원","강원도":"강원","충청북도":"충북","충청남도":"충남","전북특별자치도":"전북","전라북도":"전북","전라남도":"전남","경상북도":"경북","경상남도":"경남","제주특별자치도":"제주","제주도":"제주","서울":"서울","부산":"부산","대구":"대구","인천":"인천","광주":"광주","대전":"대전","울산":"울산","세종":"세종","경기":"경기","강원":"강원","충북":"충북","충남":"충남","전북":"전북","전남":"전남","경북":"경북","경남":"경남","제주":"제주"}'::jsonb;
 token constant text := '(세종특별자치시|강원특별자치도|전북특별자치도|제주특별자치도|서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|경기도|강원도|제주도|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)?([0-9]{2,3}[가-힣][0-9]{4}|[0-9]{0,1}[가-힣][0-9]{0,1}[0-9]{4})';
begin
 if raw is null or length(raw)>64 then return null; end if;
 -- JS raw.length counts UTF-16 units (supplementary characters count twice).
 if (select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)
     from regexp_split_to_table(raw,'') ch)>64 then return null; end if;
 t:=regexp_replace(normalize(raw,NFKC) collate "C",
   '['||U&'\00ad\0600-\0605\061c\06dd\070f\0890-\0891\08e2\180e\200b-\200f\202a-\202e\2060-\2064\2066-\206f\feff\fff9-\fffb\+0110bd\+0110cd\+013430-\+01343f\+01bca0-\+01bca3\+01d173-\+01d17a\+0e0001\+0e0020-\+0e007f\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF'||'-]','','g');
 loop
  first_pos:=regexp_instr(t collate "C",token,pos);
  exit when first_pos=0;
  hit:=regexp_match(substr(t,first_pos) collate "C",'^'||token);
  end_pos:=first_pos+length(coalesce(hit[1],'')||hit[2]);
  pos:=end_pos; -- consume rejected matches too, exactly like JS matchAll
  if (first_pos>1 and substr(t,first_pos-1,1) collate "C" ~ '[0-9ᄀ-ᇿㄱ-ㆎ가-힣]')
     or substr(t,end_pos,1) collate "C" ~ '[0-9ᄀ-ᇿㄱ-ㆎ가-힣]' then continue; end if;
  candidate:=coalesce(names->>hit[1],'')||hit[2];
  if found is not null and found<>candidate then return null; end if;
  found:=candidate;
 end loop;
 return found;
end $$;

-- Fast path (Opus 2026-10-13, prod rollback measurement): the previous strict parser accepts >99.9% of stored plates
-- and is ~7x cheaper per row than the token scan below; screen aggregation calls screen_plate once per fact, so the
-- slow normalizer alone made a 12-month screen ~30% slower (7.6s -> 9.8s) for +6 recognized plates. Anything the
-- strict parser accepts, the token scan returns identically (same NFKC/space/hyphen cleanup, whole-string token,
-- same region dictionary), so trying it first keeps exact parity while the scan only runs for irregular values.
create or replace function private.screen_plate_strict(raw text) returns text
language plpgsql immutable set search_path='' as $$
declare t text; prefix text; region text:=''; names jsonb := '{"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원", "충청북도": "충북", "충청남도": "충남", "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주", "제주도": "제주", "서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천", "광주": "광주", "대전": "대전", "울산": "울산", "세종": "세종", "경기": "경기", "강원": "강원", "충북": "충북", "충남": "충남", "전북": "전북", "전남": "전남", "경북": "경북", "경남": "경남", "제주": "제주"}'::jsonb;
begin
 if raw is null or length(raw)>64 then return null;end if;
 t:=regexp_replace(normalize(raw,NFKC),'['||U&'\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF'||'-]','','g');
 prefix:=substring(t from '^[가-힣]+');
 if prefix is not null then
  region:=names->>prefix;
  if region is null then return null;end if;
  t:=substr(t,length(prefix)+1);
 end if;
 if t !~ '^[0-9]{2,3}[가-힣][0-9]{4}$' then return null;end if;
 return region||t;
end $$;
revoke all on function private.screen_plate_strict(text) from public,anon,authenticated;

create or replace function private.screen_plate(raw text) returns text
language plpgsql immutable set search_path='' as $$
declare plate text:=private.screen_plate_strict(raw);
begin
 if plate is not null then return plate; end if;
 plate:=private.screen_normalize_plate(raw);
 -- Motorcycle identities are valid privately but have no approved public masking layout.
 if plate collate "C" ~ '^([가-힣]+)?[0-9]{2,3}[가-힣][0-9]{4}$' then return plate; end if;
 return null;
end $$;
revoke all on function private.screen_normalize_plate(text) from public,anon,authenticated;
grant execute on function private.screen_normalize_plate(text) to service_role;
-- Existing screen_plate ACL is preserved by CREATE OR REPLACE.
-- Invalidate both exact and bounded-stale results under the new read-time rules.
select private.community_bump_projection();
update private.screen_cache_epoch set revision=revision+1 where singleton;

do $verify$
declare v jsonb; actual text; public_expected text; n integer:=0;
begin
 for v in select value from jsonb_array_elements($vectors${
  "version": "2026-10-12.1",
  "note": "세 레포(safetyreport, safetyreport-mobile, safetyreport-community-map) 공통 normalizePlate 벡터. 바이트가 세 레포에서 같아야 한다. 규칙 설명은 각 레포의 plate_normalize 모듈 docstring/주석을 본다.",
  "cases": [
    { "name": "real_unrecognized_label", "raw": "미인식", "expected": null, "note": "주정차/기타 응답에 쓰이는 '미인식' 그대로" },
    { "name": "real_trailing_paren_3digit", "raw": "177도7967)", "expected": "177도7967", "note": "끝 군더더기 ')' 는 구두점 — 통과" },
    { "name": "real_trailing_paren_2digit", "raw": "40라1805)", "expected": "40라1805", "note": "끝 군더더기 ')'" },
    { "name": "real_trailing_glued_hangul", "raw": "81수0136수", "expected": null, "note": "번호판 바로 뒤에 한글 한 글자가 구분자 없이 붙음 — 경계 불분명" },
    { "name": "real_region_trailing_glued_hangul", "raw": "대구81아7901구", "expected": null, "note": "지역 접두 + 번호판 뒤에 한글 한 글자가 구분자 없이 붙음 — 경계 불분명" },
    { "name": "contrast_region_trailing_paren", "raw": "대구81아7901)", "expected": "대구81아7901", "note": "위 사례와 대조 — 뒤에 붙은 게 구두점이면 통과(경계 규칙 문서화용)" },
    { "name": "real_description_slash_1", "raw": "235호2929/흰색SUV차량입니다.", "expected": "235호2929", "note": "'/' 뒤는 설명 문구 — 통과" },
    { "name": "real_description_slash_2", "raw": "22거8784/승용차량입니다.", "expected": "22거8784", "note": "'/' 뒤는 설명 문구 — 통과" },
    { "name": "real_suspect_invisible_1", "raw": "14두7874", "expected": "14두7874", "note": "실데이터에서 보이지 않는 문자 혼입 의심 — 정규화가 Cf(서식) 문자를 모두 제거하므로 실제로 끼어 있어도 결과는 같다" },
    { "name": "real_suspect_invisible_2", "raw": "46부3555", "expected": "46부3555", "note": "위와 같음" },
    { "name": "real_suspect_invisible_zwsp", "raw": "14​두​7874", "expected": "14두7874", "note": "제로폭 공백(U+200B) 혼입 — 제거 후 정상 인식" },
    { "name": "real_suspect_invisible_bom", "raw": "46﻿부3555", "expected": "46부3555", "note": "BOM/ZWNBSP(U+FEFF) 혼입 — 제거 후 정상 인식" },
    { "name": "real_date_dotted", "raw": "2024.06.05", "expected": null, "note": "날짜, 번호판 아님" },
    { "name": "real_free_text", "raw": "중앙선침범", "expected": null, "note": "숫자 없는 설명 문구" },
    { "name": "real_date_dashed", "raw": "202-12-29", "expected": null, "note": "하이픈 제거 후 순수 숫자만 남음" },
    { "name": "real_short_digits", "raw": "4450", "expected": null, "note": "숫자만, 번호판 아님" },
    { "name": "real_long_digits", "raw": "1478991", "expected": null, "note": "숫자만, 번호판 아님" },
    { "name": "real_digit_overrun_5tail", "raw": "25어95505", "expected": null, "note": "자리수 오류 — 끝 숫자가 5개(4개 초과분이 경계에 붙어 있음)" },
    { "name": "real_jamo_not_syllable", "raw": "04ㅁ2463", "expected": null, "note": "자모 오류 — 'ㅁ' 은 낱자모(U+3141), 음절(가-힣) 아님" },
    { "name": "real_jamo_mixed_tail", "raw": "34모3ㄷ07", "expected": null, "note": "자모 오류 — 끝 4자리 숫자 run 이 자모로 끊김" },
    { "name": "real_digit_overrun_5tail_2", "raw": "20마05850", "expected": null, "note": "자리수 오류 — 끝 숫자 5개" },
    { "name": "real_digit_overrun_leading", "raw": "0006마8861", "expected": null, "note": "자리수 오류 — 앞 숫자가 4개(지역번호 2~3자리 초과분이 경계에 붙어 있음)" },
    { "name": "real_region_prefix_3digit_tail", "raw": "경기53바415", "expected": null, "note": "지역 접두 + 끝 숫자 3자리(4자리 미만) — 구형/오류, 끝 숫자 4자리를 채울 수 없어 토큰 자체가 없음" },
    { "name": "real_not_plate_registry_like", "raw": "김천시장010358", "expected": null, "note": "'김천'은 17개 시도 약칭에 없음 — 숫자 앞에 한글이 없어 본문 패턴 불성립" },
    { "name": "normal_car_2digit", "raw": "12가3456", "expected": "12가3456" },
    { "name": "normal_car_3digit", "raw": "123가4567", "expected": "123가4567" },
    { "name": "normal_region_short_seoul", "raw": "서울12가3456", "expected": "서울12가3456" },
    { "name": "normal_region_short_busan", "raw": "부산12가3456", "expected": "부산12가3456" },
    { "name": "normal_region_full_to_short_seoul", "raw": "서울특별시12가3456", "expected": "서울12가3456", "note": "공식 전체 이름도 약칭으로 정규화" },
    { "name": "normal_with_space_hyphen", "raw": "경기 123가-4567", "expected": "경기123가4567", "note": "번호판 표기상의 공백·하이픈은 제거" },
    { "name": "normal_region_already_example", "raw": "경기76자3623", "expected": "경기76자3623" },
    { "name": "normal_fullwidth_digits", "raw": "１２가３４５６", "expected": "12가3456", "note": "전각 숫자 — NFKC 로 반각 변환" },
    { "name": "normal_internal_space_only", "raw": "12가 3456", "expected": "12가3456" },
    { "name": "edge_null_input", "raw": null, "expected": null },
    { "name": "edge_empty_string", "raw": "", "expected": null },
    { "name": "edge_plain_text", "raw": "unknown", "expected": null },
    { "name": "motorcycle_1digit_lead", "raw": "3호1234", "expected": "3호1234", "note": "이륜형 — 앞 숫자 1자리" },
    { "name": "motorcycle_0digit_lead", "raw": "가1234", "expected": "가1234", "note": "이륜형 — 앞 숫자 0자리" },
    { "name": "motorcycle_with_region", "raw": "서울3호1234", "expected": "서울3호1234", "note": "이륜형 + 지역 접두" },
    { "name": "motorcycle_optional_mid_digit", "raw": "3호51234", "expected": "3호51234", "note": "이륜형 — 한글 뒤 선택 숫자 1개 + 필수 4자리" },
    { "name": "region_prefix_jeonbuk_short", "raw": "전북12가3456", "expected": "전북12가3456" },
    { "name": "region_prefix_jeonbuk_full_old", "raw": "전라북도12가3456", "expected": "전북12가3456" },
    { "name": "region_prefix_gangwon_do", "raw": "강원도12가3456", "expected": "강원12가3456" },
    { "name": "region_prefix_gangwon_special", "raw": "강원특별자치도12가3456", "expected": "강원12가3456" },
    { "name": "region_prefix_jeju_do", "raw": "제주도12가3456", "expected": "제주12가3456" },
    { "name": "old_style_single_digit_region_no", "raw": "2가1234", "expected": "2가1234", "note": "구형(한 자리 지역번호) — 일반형 최소 2자리에는 못 미쳐 이륜형 패턴으로 수용" },
    { "name": "ambiguous_two_distinct_candidates", "raw": "12가3456/34나5678", "expected": null, "note": "서로 다른 유효 후보 2개 — 추측 금지로 null" },
    { "name": "boundary_latin_prefix_ok", "raw": "a12가3456", "expected": "12가3456", "note": "영문자는 경계로 허용(숫자·한글만 경계 위반)" },
    { "name": "boundary_digit_overrun_glued", "raw": "12가34567", "expected": null, "note": "번호판 뒤에 숫자 하나가 구분자 없이 더 붙음 — 경계 불분명" },
    { "name": "ambiguous_two_plates_space_joined", "raw": "12가3456 34나5678", "expected": null, "note": "공백이 정규화에서 모두 제거되어 두 번호판이 맞붙음 — 양쪽 다 경계 위반으로 폐기(결과는 역시 null)" },
    { "name": "edge_non_plate_dash_text", "raw": "UNKNOWN-PRIVATE-PLATE", "expected": null },
    { "name": "edge_too_long", "raw": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "expected": null, "note": "65자 초과 — 길이 상한" }
  ]
}$vectors$::jsonb->'cases') loop
  actual:=private.screen_normalize_plate(v->>'raw');
  if actual is distinct from v->>'expected' then
   raise exception 'normalization mismatch: %', v->>'name';
  end if;
  public_expected:=case when (v->>'expected') collate "C" ~ '^([가-힣]+)?[0-9]{2,3}[가-힣][0-9]{4}$' then v->>'expected' else null end;
  if private.screen_plate(v->>'raw') is distinct from public_expected then
   raise exception 'public projection mismatch: %', v->>'name';
  end if;
  if public_expected is not null then perform private.screen_mask_plate(public_expected); end if;
  n:=n+1;
 end loop;
 raise notice 'PASS: % shared normalization vectors and public masking projections', n;
end $verify$;
rollback;
