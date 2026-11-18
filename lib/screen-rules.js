// 참가 가능 여부 선별: 공고문·첨부 문서에서 '본사 소재지' 등 지역 제한을 찾아 우리 회사 소재지와 대조
// 확실히 걸리는 것(지역 제한 불일치)만 '참가 불가'로 거르고, 나머지는 리포트의 확인 항목으로 둔다

// 시·도 표기 → 표준 이름
export const SIDO = [
  ["서울", /서울(?:특별시|시)?/],
  ["부산", /부산(?:광역시|시)?/],
  ["대구", /대구(?:광역시|시)?/],
  ["인천", /인천(?:광역시|시)?/],
  ["광주", /광주광역시|광주시(?!\s*(?:경기|오포|초월))/],
  ["대전", /대전(?:광역시|시)?/],
  ["울산", /울산(?:광역시|시)?/],
  ["세종", /세종(?:특별자치시|시)/],
  ["경기", /경기도|경기\s*지역/],
  ["강원", /강원(?:특별자치)?도|강원\s*지역/],
  ["충북", /충청북도|충북/],
  ["충남", /충청남도|충남/],
  ["전북", /전라북도|전북(?:특별자치도)?/],
  ["전남", /전라남도|전남/],
  ["경북", /경상북도|경북/],
  ["경남", /경상남도|경남/],
  ["제주", /제주(?:특별자치)?도|제주\s*지역/],
];
export const SIDO_NAMES = SIDO.map(([n]) => n);
export const SIDO_FULL = { 서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시", 인천: "인천광역시", 광주: "광주광역시", 대전: "대전광역시", 울산: "울산광역시", 세종: "세종특별자치시", 경기: "경기도", 강원: "강원특별자치도", 충북: "충청북도", 충남: "충청남도", 전북: "전북특별자치도", 전남: "전라남도", 경북: "경상북도", 경남: "경상남도", 제주: "제주특별자치도" };
const full = (n) => SIDO_FULL[n] || n;
const toSido = (s) => SIDO.filter(([, re]) => re.test(s)).map(([n]) => n);

// 본사·주된 영업소 소재지를 참가 조건으로 거는 문장
const HQ = /(본사|본점|주된\s*영업소|주\s*사무소|법인\s*등기부\s*등본\s*상|사업자\s*등록\s*(?:증\s*)?상|소재지)/;
const LIMIT = /(소재(?:한|하는|하고|하여|해야|지를\s*둔)?|두고\s*있는|둔\s*(?:업체|자)|위치한|있는\s*(?:업체|자)|한(?:함|한다|정)|제한|입찰\s*(?:불가|가능)|참가\s*(?:불가|가능))/;
const NOT_COND = /(납품\s*장소|수행\s*장소|과업\s*장소|용역\s*장소|설치\s*장소|촬영|출장|교육\s*장소|방문|직접\s*제출|제출\s*처|접수\s*처|수요\s*기관\s*(?:소재|위치)|발주\s*기관|문의|담당자|주소\s*:|소재지\s*:)/;

/** 문서 줄에서 본사 소재지 제한 찾기 → { regions:[표준 시·도], quote, source } | null */
export function findRegionLimit(files) {
  for (const f of files || []) {
    const lines = String(f.text || "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 8 && l.length <= 400);
    for (let i = 0; i < lines.length; i++) {
      // 줄바꿈으로 잘린 문장 대비: 다음 줄까지 이어 본다
      const l = lines[i].length < 60 && lines[i + 1] ? `${lines[i]} ${lines[i + 1]}` : lines[i];
      if (!HQ.test(l) || !LIMIT.test(l) || NOT_COND.test(l)) continue;
      const regions = toSido(l);
      if (!regions.length) continue;
      // 지역 이름이 '본사·소재' 표현 가까이에 있어야 조건으로 본다
      const near = /(본사|본점|주된\s*영업소|소재지?)[^.]{0,40}(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)|(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)[^.]{0,40}(소재|두고|위치|본사|본점)/;
      if (!near.test(l)) continue;
      return { regions, quote: l.slice(0, 220), source: f.name || "" };
    }
  }
  return null;
}

/**
 * 참가 가능 판정
 *  apiRegions: 나라장터 참가가능지역 목록(빈 배열 = 전국, null = 모름) 또는 '서울, 경기' 같은 문자열
 *  limit: findRegionLimit 결과
 * → { ok:false, item, detail, quote, source } | { ok:true } | null(판단 근거 없음)
 */
export function judge({ apiRegions, limit, company }) {
  const mine = company?.region || "서울";
  const api = typeof apiRegions === "string" ? (apiRegions === "전국" ? [] : apiRegions.split(/\s*,\s*/)) : apiRegions;
  if (Array.isArray(api) && api.length) {
    const ok = api.some((r) => /전국/.test(r) || toSido(r).includes(mine));
    if (!ok) return { ok: false, item: "지역 제한", detail: `참가 가능 지역 ${api.join(", ")} · 우리 회사 ${full(mine)}`, quote: "", source: "나라장터 참가가능지역" };
  }
  if (limit?.regions?.length && !limit.regions.includes(mine)) {
    const sub = /지사/.test(limit.quote) && /(불가|제외|불인정|안\s*됨)/.test(limit.quote) ? " · 지사 불가" : "";
    return { ok: false, item: "지역 제한", detail: `본사 ${limit.regions.map(full).join("·")} 소재 업체만 참가${sub} · 우리 회사 ${full(mine)}`, quote: limit.quote, source: limit.source };
  }
  if (Array.isArray(api) || limit) return { ok: true };
  return null;
}

/** 분석 결과에 이미 있는 문장들로 판정 (리포트·재분석용) */
export function judgeFromAnalysis(bid, a, company) {
  const lines = [];
  const kr = a?.keyReview?.region;
  if (kr?.quote) lines.push(kr.quote);
  if (kr?.value) lines.push(`본사 ${kr.value}`);
  for (const g of a?.precheck?.gate || []) if (g.id === "g-region") lines.push(g.detail || "", ...(g.evidence || []));
  for (const x of [...(a?.eligibility || []), ...(a?.cautions || [])]) lines.push(String(x));
  const limit = findRegionLimit([{ name: "분석 결과", text: lines.join("\n") }]);
  return judge({ apiRegions: bid.region ?? null, limit, company });
}

