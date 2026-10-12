-- Read-time normalization parity with server/plate.ts; no stored fact is rewritten.
-- New helper accepts general/motorcycle tokens. screen_plate remains the public,
-- safely maskable general-plate projection (the same boundary as parsePlate).
-- CLI migration creation was blocked by its home telemetry write in this sandbox.
begin;
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
commit;
