/** 비공개 서버 번호판 처리. 브라우저 코드에서 가져오지 않는다. */

// ── 세 레포(safetyreport, safetyreport-mobile, safetyreport-community-map) 공통 번호판 정규화 ──
//
// **원문(vehicle_raw)은 절대 바꾸지 않는다.** `normalizePlate` 는 저장된 사실을 그대로 두고 "읽을 때"
// (통계·랭킹·마스킹·개인 차량 목록) 번호판 토큰만 뽑아내는 순수 함수다. 세 레포가 같은 규칙을 쓴다 —
// 하나를 바꾸면 세 레포의 공유 벡터 파일(바이트 동일)과 이 문서를 함께 바꾼다:
//   - safetyreport:                tests/fixtures/plate_normalize_vectors.json
//   - safetyreport-mobile:         test/fixtures/plate_normalize_vectors.json
//   - safetyreport-community-map:  tests/fixtures/plate_normalize_vectors.json (이 파일이 구현)
//
// ## 규칙 (경계 규칙 포함, 2026-10-13 이륜 확장 포함)
// 1. NFKC 정규화 → 공백 전부(스페이스·탭·NBSP·전각공백 등) · 유니코드 서식 문자(Unicode category Cf —
//    제로폭 공백/조인터, LRM/RLM, bidi 제어, BOM 등, 실제로 섞여 있어도 보이지 않으므로 통째로 제거) ·
//    하이픈(`-`, NFKC 가 전각 하이픈도 반각으로 접어 주므로 이 한 글자만 지우면 된다) 제거.
// 2. 남은 문자열에서 "지역 접두(아래 `regions`, 긴 이름부터 시도) + 본문" 패턴과 일치하는 구간을 전부
//    찾는다. 본문 = 일반형(숫자 2~3자리 + 한글 1자 + 숫자 4자리, 기존 `bodyPattern`)
//    또는 이륜형(숫자 0~1자리 + 한글 1자 + 숫자 0~1자리 + 숫자 4자리, PC `fine_estimate._MOTORCYCLE_RE`/
//    모바일 `_motorcycleRe` 와 같음).
// 3. 찾은 구간의 바로 앞/뒤 문자가 숫자(0-9) 또는 한글(음절 가-힣, 또는 낱자모 ㄱ-ㅎ/ㅏ-ㅣ)이면 그
//    구간은 버린다("경계가 애매하면 null") — `81수0136수`(번호판 뒤에 한글 한 글자가 구분자 없이 더
//    붙음), `25어95505`(끝 숫자가 5개 — 4자리를 넘는 초과분이 경계에 붙음), `0006마8861`(지역번호
//    2~3자리를 넘는 초과분이 앞 경계에 붙음) 같은 자리수 오류·군더더기를 걸러낸다.
//    구두점·기호·영문·다른 언어 문장은 경계로 허용한다 — `177도7967)`, `235호2929/흰색SUV차량입니다.`
//    는 통과. (공백은 1단계에서 모두 지우므로, 설명 문구와 번호판 사이에 공백만 있고 다른 구분자가
//    없으면 경계가 사라져 모호로 처리될 수 있다. 실데이터의 설명 붙은 사례는 모두 `/` 로 구분되어
//    있어 영향이 없었다.)
// 4. 경계를 통과한 서로 다른 후보가 정확히 1개면 그 값(지역은 약칭으로 정규화)을 반환한다. 0개
//    (미인식·날짜·숫자만·자모 섞임·자리수 오류 등) 또는 2개 이상(서로 다른 후보)이면 null — 추측하지
//    않는다. 입력이 64자를 넘으면(업로드 payload 상한과 같음) null.
//
// 2026-10-13: 지역 필수 이륜형 = 지역 + 시군구(1~3자, 별도 시/군/구 접미 허용) + 글자 + 숫자4.
// 숫자 앞 마지막 글자를 용도 글자로 고정하며 시군구 끝 접미 한 글자를 제거한다(1자 지명 보존).
// 접미가 중복되거나 약칭과 지명이 다시 지역 정식명으로 읽혀 정규형이 모호하면 제외한다.
// parsePlate도 이륜형을 허용한다. 이륜은 지역·시군구·글자·선행 숫자를 보존하고,
// 글자 뒤 선택 숫자와 끝 4자리의 첫째·셋째를 가린다: 경기군포다*6*1, 1오**3*7.

const regions: Record<string, string> = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천',
  광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종',
  경기도: '경기', 강원특별자치도: '강원', 강원도: '강원', 충청북도: '충북',
  충청남도: '충남', 전북특별자치도: '전북', 전라북도: '전북', 전라남도: '전남',
  경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주', 제주도: '제주',
};
for (const short of Object.values(regions)) regions[short] = short;
const regionAlt = Object.keys(regions).sort((a, b) => b.length - a.length).join('|');

// 일반형 — 기존 bodyPattern 과 같다.
const bodyPattern = /^[0-9]{2,3}[가-힣][0-9]{4}$/u;
// 이륜형(완화된 형태) — PC fine_estimate._MOTORCYCLE_RE/모바일 _motorcycleRe 와 같다.
const motoBody = '[0-9]{0,1}[가-힣][0-9]{0,1}[0-9]{4}';
const tokenRe = new RegExp(`(${regionAlt})?([0-9]{2,3}[가-힣][0-9]{4}|${motoBody}|[가-힣]{2,5}[0-9]{4})`, 'gu');
// 토큰 경계: 숫자 또는 한글(음절/낱자모)이 바로 붙어 있으면 경계가 불분명하다.
const adjacentRe = /[0-9ᄀ-ᇿㄱ-ㆎ가-힣]/u;
const formatCharRe = /\p{Cf}/gu;
const stripRe = /[-\s]/gu;
const MAX_RAW_LENGTH = 64;

/** 정리한 문자열에서 유효한 번호판 토큰을 정확히 하나 찾으면 {region, body} 를, 아니면 null 을 돌려준다. */
function findPlateToken(raw: unknown): { region: string; body: string } | null {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_LENGTH) return null;
  const text = raw.normalize('NFKC').replace(formatCharRe, '').replace(stripRe, '');
  if (!text) return null;

  const seen = new Map<string, { region: string; body: string }>();
  for (const match of text.matchAll(tokenRe)) {
    let body = match[2];
    if (!body) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > 0 && adjacentRe.test(text[start - 1])) continue;
    if (end < text.length && adjacentRe.test(text[end])) continue;
    const rawRegion = match[1] ?? '';
    const region = regions[rawRegion] ?? rawRegion;
    if (/^[가-힣]{2,5}[0-9]{4}$/u.test(body)) {
      if (!region) continue;
      let city = body.slice(0, -5);
      if (city.length > 1) city = city.replace(/[시군구]$/u, '');
      if (city.length > 1 && /[시군구]$/u.test(city)) continue;
      if (city.length < 1 || city.length > 3) continue;
      if (regions[region + city[0]] === region) continue;
      body = city + body.slice(-5);
    }
    seen.set(region + body, { region, body });
  }
  if (seen.size !== 1) return null;
  return [...seen.values()][0];
}

/** 세 레포 공통 정규화 — 유효한 번호판이 정확히 하나면 그 값(지역 약칭 + 본문, 일반형·이륜형 모두), 아니면 null. */
export function normalizePlate(raw: unknown): string | null {
  const found = findPlateToken(raw);
  return found ? found.region + found.body : null;
}

export interface ParsedPlate {
  /** Server-only vehicle identity; the regional prefix remains significant. */
  canonical: string;
  /** Short regional prefix such as '경기', or '' when the plate has none. */
  region: string;
  /** Prefix-free supported plate body. */
  body: string;
}

/** Short regional prefixes that may appear in a public masked plate. */
export const PUBLIC_REGION_PREFIXES: readonly string[] = [...new Set(Object.values(regions))];

/** 통계·랭킹·마스킹·개인 차량 목록이 쓰는 공개 경로 — 일반형·이륜형을 함께 받는다. */
export function parsePlate(raw: unknown): ParsedPlate | null {
  const found = findPlateToken(raw);
  if (!found) return null;
  return { canonical: found.region + found.body, region: found.region, body: found.body };
}

/** 공개 표시: 일반형 앞 숫자 둘째와 끝 4자리 첫째·셋째를 가린다.
 * 이륜형은 글자 뒤 선택 숫자도 가린다. 지역·시군구·용도 글자는 보존한다.
 */
export function maskPlate(raw: unknown): string {
  const parsed = parsePlate(raw);
  if (!parsed) return '번호 확인 불가';
  if (!bodyPattern.test(parsed.body)) {
    // 끝 4자리는 정확히 두 자리만 공개하며 중간 선택 숫자는 모두 가린다.
    const tail = parsed.body.slice(-4);
    const head = parsed.body.slice(0, -4).replace(/[0-9]$/u, '*');
    return parsed.region + head + '*' + tail[1] + '*' + tail[3];
  }
  const head = parsed.body.slice(0, -4);
  const tail = parsed.body.slice(-4);
  return parsed.region + head[0] + '*' + head.slice(2) + '*' + tail[1] + '*' + tail[3];
}
