-- 이륜차 정규화·공개 가림. 원문 vehicle_raw 및 수집 이벤트는 수정하지 않는다.
-- CLI는 샌드박스 밖 telemetry 파일 쓰기로 실행이 차단되어 지정 시각으로 파일을 만든다.
begin;
set local lock_timeout='3s';
-- 저장 투영(폐기된 202610061200_ingest_precompute의 private.screen_observations·screen_precompute_lock)은
-- 배포마다 있을 수도 없을 수도 있다(2026-10-16 운영 확인 전제). 둘 다 있을 때만 기존 투영 갱신과 같은 잠금
-- 순서로 직렬화하고 아래에서 저장값을 재계산한다. 둘 다 없으면 함수 교체와 캐시 무효화만 한다.
-- 한쪽만 있는 상태는 알 수 없는 배포라 조용히 넘어가지 않고 트랜잭션 전체를 중단한다.
do $precompute_lock$
declare has_lock boolean:=to_regprocedure('private.screen_precompute_lock()') is not null;
 has_observations boolean:=to_regclass('private.screen_observations') is not null;
begin
 if has_lock<>has_observations then
  raise exception 'screen precompute objects are partial (lock function %, observations table %)',has_lock,has_observations;
 end if;
 if has_lock then execute 'select private.screen_precompute_lock()'; end if;
end $precompute_lock$;

create or replace function private.screen_normalize_plate(raw text) returns text
language plpgsql immutable set search_path='' as $$
declare
 t text; hit text[]; body text; city text; candidate text; found text;
 pos integer:=1; first_pos integer; end_pos integer;
 names constant jsonb := '{"서울특별시":"서울","부산광역시":"부산","대구광역시":"대구","인천광역시":"인천","광주광역시":"광주","대전광역시":"대전","울산광역시":"울산","세종특별자치시":"세종","경기도":"경기","강원특별자치도":"강원","강원도":"강원","충청북도":"충북","충청남도":"충남","전북특별자치도":"전북","전라북도":"전북","전라남도":"전남","경상북도":"경북","경상남도":"경남","제주특별자치도":"제주","제주도":"제주","서울":"서울","부산":"부산","대구":"대구","인천":"인천","광주":"광주","대전":"대전","울산":"울산","세종":"세종","경기":"경기","강원":"강원","충북":"충북","충남":"충남","전북":"전북","전남":"전남","경북":"경북","경남":"경남","제주":"제주"}'::jsonb;
 token constant text := '(세종특별자치시|강원특별자치도|전북특별자치도|제주특별자치도|서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|경기도|강원도|제주도|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)?([0-9]{2,3}[가-힣][0-9]{4}|[0-9]{0,1}[가-힣][0-9]{0,1}[0-9]{4}|[가-힣]{2,5}[0-9]{4})';
begin
 if raw is null or length(raw)>64 then return null; end if;
 -- UTF-16 길이 상한은 보충 문자가 있을 수 있는 긴 입력에만 추가 계산한다.
 if length(raw)>32 and (select sum(case when ascii(ch)>65535 then 2 else 1 end)
     from regexp_split_to_table(raw,'') ch)>64 then return null; end if;
 t:=regexp_replace(normalize(raw,NFKC) collate "C",
   '['||U&'\00ad\0600-\0605\061c\06dd\070f\0890-\0891\08e2\180e\200b-\200f\202a-\202e\2060-\2064\2066-\206f\feff\fff9-\fffb\+0110bd\+0110cd\+013430-\+01343f\+01bca0-\+01bca3\+01d173-\+01d17a\+0e0001\+0e0020-\+0e007f\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF'||'-]','','g');
 loop
  first_pos:=regexp_instr(t collate "C",token,pos);
  exit when first_pos=0;
  hit:=regexp_match(substr(t,first_pos) collate "C",'^'||token);
  end_pos:=first_pos+length(coalesce(hit[1],'')||hit[2]);
  pos:=end_pos;
  if (first_pos>1 and substr(t,first_pos-1,1) collate "C" ~ '[0-9ᄀ-ᇿㄱ-ㆎ가-힣]')
     or substr(t,end_pos,1) collate "C" ~ '[0-9ᄀ-ᇿㄱ-ㆎ가-힣]' then continue; end if;
  body:=hit[2];
  if body collate "C" ~ '^[가-힣]{2,5}[0-9]{4}$' then
   if hit[1] is null then continue; end if;
   city:=left(body,length(body)-5);
   if length(city)>1 and right(city,1) in ('시','군','구') then city:=left(city,length(city)-1); end if;
   if length(city)>1 and right(city,1) in ('시','군','구') then continue; end if;
   if length(city) not between 1 and 3 then continue; end if;
   if names->>((names->>hit[1])||left(city,1)) = names->>hit[1] then continue; end if;
   body:=city||right(body,5);
  end if;
  candidate:=coalesce(names->>hit[1],'')||body;
  if found is not null and found<>candidate then return null; end if;
  found:=candidate;
 end loop;
 return found;
end $$;

-- 문자열 전체가 번호판인 흔한 입력은 토큰 탐색 없이 같은 정규형으로 반환한다.
create or replace function private.screen_plate_strict(raw text) returns text
language plpgsql immutable set search_path='' as $$
declare t text; prefix text; region text:=''; hit text[]; body text; city text; candidate text;
 names constant jsonb := '{"서울특별시":"서울","부산광역시":"부산","대구광역시":"대구","인천광역시":"인천","광주광역시":"광주","대전광역시":"대전","울산광역시":"울산","세종특별자치시":"세종","경기도":"경기","강원특별자치도":"강원","강원도":"강원","충청북도":"충북","충청남도":"충남","전북특별자치도":"전북","전라북도":"전북","전라남도":"전남","경상북도":"경북","경상남도":"경남","제주특별자치도":"제주","제주도":"제주","서울":"서울","부산":"부산","대구":"대구","인천":"인천","광주":"광주","대전":"대전","울산":"울산","세종":"세종","경기":"경기","강원":"강원","충북":"충북","충남":"충남","전북":"전북","전남":"전남","경북":"경북","경남":"경남","제주":"제주"}'::jsonb;
 token constant text := '(세종특별자치시|강원특별자치도|전북특별자치도|제주특별자치도|서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|경기도|강원도|제주도|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)?([0-9]{2,3}[가-힣][0-9]{4}|[0-9]{0,1}[가-힣][0-9]{0,1}[0-9]{4}|[가-힣]{2,5}[0-9]{4})';
begin
 if raw is null or length(raw)>64 then return null; end if;
 -- 일반적인 승용형을 먼저 작은 정규식과 사전 조회로 처리한다.
 -- 서식 문자 등은 이 경로에서 실패하면 아래 느린 경로가 동일 규칙으로 처리한다.
 t:=regexp_replace(normalize(raw,NFKC) collate "C",'['||U&'\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF'||'-]','','g');
 prefix:=substring(t collate "C" from '^[가-힣]+');
 if prefix is not null and names ? prefix then
  region:=names->>prefix;
  body:=substr(t,length(prefix)+1);
 else body:=t;
 end if;
 if body collate "C" ~ '^([0-9]{2,3}[가-힣][0-9]{4}|[0-9]{0,1}[가-힣][0-9]{4,5})$' then
  return region||body;
 end if;
 hit:=regexp_match(t collate "C",'^'||token||'$');
 if hit is null then return null; end if;
  body:=hit[2];
  if body collate "C" ~ '^[가-힣]{2,5}[0-9]{4}$' then
   if hit[1] is null then return null; end if;
   city:=left(body,length(body)-5);
   if length(city)>1 and right(city,1) in ('시','군','구') then city:=left(city,length(city)-1); end if;
   if length(city)>1 and right(city,1) in ('시','군','구') then return null; end if;
   if length(city) not between 1 and 3 then return null; end if;
   if names->>((names->>hit[1])||left(city,1)) = names->>hit[1] then return null; end if;
   body:=city||right(body,5);
  end if;
  candidate:=coalesce(names->>hit[1],'')||body;
 return candidate;
end $$;

create or replace function private.screen_plate(raw text) returns text
language plpgsql immutable set search_path='' as $$
declare plate text:=private.screen_plate_strict(raw);
begin
 if plate is not null then return plate; end if;
 return private.screen_normalize_plate(raw);
end $$;

-- 공개 가림의 입력은 screen_plate가 검증한 정규형이다. 지역 약칭을 다시 긴 이름으로 해석하지 않는다.
create or replace function private.screen_mask_plate(t text) returns text
language plpgsql immutable set search_path='' as $$
declare plate text:=t; body text; head text; tail text;
begin
 if plate is null then return '번호 확인 불가'; end if;
 if plate collate "C" !~ '^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)?(?:[0-9]{2,3}[가-힣][0-9]{4}|[0-9]?[가-힣][0-9]{4,5})$'
    and plate collate "C" !~ '^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣]{2,4}[0-9]{4}$' then return '번호 확인 불가'; end if;
 body:=substring(plate collate "C" from '[0-9]{2,3}[가-힣][0-9]{4}$');
 tail:=right(plate,4);
 if body is not null then
  head:=left(body,length(body)-4);
  head:=substr(head,1,1)||'*'||substr(head,3);
  return left(plate,length(plate)-length(body))||head||'*'||substr(tail,2,1)||'*'||substr(tail,4,1);
 end if;
 head:=regexp_replace(left(plate,length(plate)-4),'[0-9]$','*');
 return head||'*'||substr(tail,2,1)||'*'||substr(tail,4,1);
end $$;

revoke all on function private.screen_normalize_plate(text),private.screen_plate_strict(text),
 private.screen_plate(text),private.screen_mask_plate(text) from public,anon,authenticated;
grant execute on function private.screen_normalize_plate(text),private.screen_plate_strict(text),
 private.screen_plate(text),private.screen_mask_plate(text) to service_role;

-- 수집 때 계산된 투영만 재계산한다. 원문·확정금액·앱 추정금액은 그대로다.
-- 저장 투영이 없는 배포는 화면 집계가 읽을 때 위 함수로 바로 계산하므로 재계산할 저장값이 없다.
do $screen_projection$
begin
 if to_regclass('private.screen_observations') is null then return; end if;
 execute $recompute$
 with normalized as materialized (
  select contributor_id,dataset_key,source_report_key,private.screen_plate(vehicle_raw) as plate
  from private.screen_observations
 ), projected as materialized (
  select *,private.screen_mask_plate(plate) as plate_mask from normalized
 )
 update private.screen_observations o set plate=p.plate,plate_mask=p.plate_mask
  from projected p where o.contributor_id=p.contributor_id and o.dataset_key=p.dataset_key
  and o.source_report_key=p.source_report_key
  and (o.plate is distinct from p.plate or o.plate_mask is distinct from p.plate_mask)
 $recompute$;
end $screen_projection$;
-- 정확 버전 캐시와 최대 180초 재사용 캐시를 모두 즉시 무효화한다.
select private.community_bump_projection();
update private.screen_cache_epoch set revision=revision+1 where singleton;
commit;
