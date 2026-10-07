// 문서에서 못 찾은 항목을 나라장터 공고 정보(API)와 공고명으로 채워서 '찾지 못함'이 남지 않게 함
const nz = (s) => String(s || "").replace(/\s+/g, "");
const has = (x) => (Array.isArray(x) ? x.length > 0 : !!x && x !== "문서에 없음");
const kst = (s) => {
  const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})\s*(\d{2}):(\d{2})/);
  return m ? `${Number(m[2])}. ${Number(m[3])}. ${m[4]}:${m[5]}` : "";
};

/** 공고명으로 사업 성격 추정 */
function kindOf(title) {
  const t = nz(title);
  if (/(이러닝|e-?러닝|원격|온라인교육|차시|교육콘텐츠|학습콘텐츠)/i.test(t)) return "elearning";
  if (/(숏폼|쇼츠|숏츠|릴스)/.test(t)) return "shorts";
  if (/(영상|동영상|촬영|편집|애니메이션|모션)/.test(t)) return "video";
  if (/(교육|연수|강의|강좌)/.test(t)) return "edu";
  return "etc";
}

const TASKS = {
  elearning: ["교육과정 기획 및 교수설계(스토리보드)", "원고·강의 촬영 및 편집", "학습 콘텐츠 개발·검수 및 탑재"],
  video: ["영상 기획 및 구성안(시나리오) 작성", "촬영 (현장·스튜디오)", "편집·자막·음악·색보정 등 후반 작업"],
  shorts: ["숏폼 기획 및 대본 작성", "촬영 및 세로형 편집", "채널 업로드용 최종본 제작"],
  edu: ["교육 프로그램 기획", "강의·교육 자료 제작", "교육 운영 지원"],
  etc: ["공고명 기준 과업 수행 (세부 과업은 원문 확인)"],
};
const DELIVER = {
  elearning: ["이러닝 콘텐츠 (차시 수는 원문 확인)", "스토리보드·원고"],
  video: ["완성 영상 (편수·길이는 원문 확인)", "원본 영상 및 편집 소스"],
  shorts: ["숏폼 영상 (편수는 원문 확인)"],
  edu: ["교육 자료·결과물 (원문 확인)"],
  etc: ["공고명 기준 결과물 (원문 확인)"],
};

/** 발표자: 문서 전체에서 '발표' 문장을 찾아 누가 발표해야 하는지 뽑음 */
const ROLE = /(사업\s*관리자|사업\s*책임자|책임\s*기술자|총괄\s*책임자|과업\s*책임자|프로젝트\s*(?:관리자|매니저|책임자)|PM|PL|대표\s*(?:자|이사)?)/;
export function presenterOf(a, docText = "") {
  const pool = [
    ...(a.presentation || []),
    ...String(docText || "").split(/\n+|(?<=[다함음임])\.\s+/).filter((x) => /발표/.test(x) && x.length < 300),
  ];
  // '발표하여야/발표한다/발표자는 …로 한정' 처럼 발표 주체를 정한 문장
  const must = pool.filter((x) => ROLE.test(x) && /(발표\s*(?:하여야|해야|하여야\s*함|한다|함|토록|할\s*것)|발표자[는은]?|직접\s*발표|발표를?\s*(?:하여야|해야)|대리\s*발표)/.test(x));
  if (!must.length) {
    if (pool.some((x) => /(발표자|발표\s*인원)[^.]{0,20}(제한\s*없|무관|자유)/.test(x))) return "제한 없음";
    return null;
  }
  const txt = must.join(" ");
  const names = [...new Set((txt.match(new RegExp(ROLE.source, "g")) || []).map((x) => x.replace(/\s+/g, "")))];
  // "사업관리자(PM)"처럼 함께 쓰인 경우 합쳐 보여줌
  const main = names.find((x) => !/^(PM|PL)$/.test(x)) || names[0];
  const abbr = names.find((x) => /^(PM|PL)$/.test(x));
  const who = main && abbr && main !== abbr ? `${main}(${abbr})` : main;
  const noProxy = /대리\s*발표[^.]{0,15}(불가|인정하지|않|금지)|직접\s*발표|반드시/.test(txt) || /하여야|해야/.test(txt);
  return `${who} 발표${noProxy ? " 필수 (대리 불가)" : ""}`;
}

/**
 * result: 분석 결과(문서 기반), bid: 공고, meta: 나라장터 API 공고 원본(없을 수 있음)
 * → 빈 항목을 채우고, 채운 항목 이름을 result.inferred 에 기록
 */
export function fillGaps(result, bid, meta = {}, docText = "") {
  const inferred = new Set(result.inferred || []);
  const kind = kindOf(bid.title);
  const m = meta || {};

  if (!has(result.tasks)) { result.tasks = TASKS[kind]; inferred.add("tasks"); }
  if (!has(result.deliverables)) { result.deliverables = DELIVER[kind]; inferred.add("deliverables"); }

  // 평가·계약 방식: 나라장터 공고 정보로 확정 가능
  const tech = Number(m.techAbltEvlRt || 0), price = Number(m.bidPrceEvlRt || 0);
  const evApi = [m.sucsfbidMthdNm, m.cntrctCnclsMthdNm].filter(Boolean)[0];
  if (!has(result.evaluation) && (evApi || tech)) {
    result.evaluation = `${evApi || ""}${tech ? ` (기술 ${tech} : 가격 ${price})` : ""}`.trim();
  } else if (has(result.evaluation) && tech && !/기술\s*\d/.test(result.evaluation)) {
    result.evaluation = `${result.evaluation} (기술 ${tech} : 가격 ${price})`;
  }
  if (!has(result.evaluation)) { result.evaluation = "공고서 참조 (나라장터 미기재)"; inferred.add("evaluation"); }
  // 평가방식은 한 줄로: "협상에 의한 계약 (기술 90 : 가격 10)"
  {
    const ev = String(Array.isArray(result.evaluation) ? result.evaluation.join(" ") : result.evaluation);
    const t = ev.match(/기술[^\d]{0,12}(\d{2})\s*점?/), pr = ev.match(/가격[^\d]{0,12}(\d{1,2})\s*점?/);
    const how = /협상/.test(ev) ? "협상에 의한 계약" : /적격\s*심사/.test(ev) ? "적격심사" : /최저/.test(ev) ? "최저가" : /2단계/.test(ev) ? "2단계 경쟁" : "";
    if (how || (t && pr)) result.evaluation = `${how || "평가"}${t && pr ? ` (기술 ${t[1]} : 가격 ${pr[1]})` : ""}`;
  }

  // 일정: 입찰마감·개찰·설명회는 나라장터 공고 정보에 항상 있음
  // 일정은 날짜가 들어간 줄만
  const DATE = /(\d{1,2}\s*[.월/]\s*\d{1,2}|\d{4}\s*[.\-]\s*\d{1,2})/;
  const sched = (Array.isArray(result.schedule) ? result.schedule : []).filter((x) => DATE.test(x) && String(x).length <= 80);
  const add = (label, v) => { if (v && !sched.some((x) => x.includes(label))) sched.push(`${label} ${v}`); };
  add("입찰마감", kst(m.bidClseDt) || (bid.close_at ? new Date(bid.close_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : ""));
  add("개찰", kst(m.opengDt));
  if (m.dcmtgOprtnDt) add("설명회", `${kst(m.dcmtgOprtnDt)}${m.dcmtgOprtnPlce ? ` (${m.dcmtgOprtnPlce})` : ""}`);
  result.schedule = sched;

  if (!has(result.period)) { result.period = "문서 미기재 (3개월로 가정)"; inferred.add("period"); }

  const who = presenterOf(result, docText);
  result.presenter = who || "문서 미기재 (통상 사업책임자 발표)";
  if (!who) inferred.add("presenter");

  if (!has(result.summary) || /AI 요약 아님|찾지 못했습니다/.test(result.summary)) {
    result.summary = `${bid.title} — ${result.tasks.slice(0, 2).join(", ")} 중심의 사업입니다.`;
    inferred.add("summary");
  }
  result.meta = {
    contract: m.cntrctCnclsMthdNm || "", award: m.sucsfbidMthdNm || "", tech, price,
    briefing: m.dcmtgOprtnDt ? kst(m.dcmtgOprtnDt) : "", contact: [m.ntceInsttOfclNm, m.ntceInsttOfclTelNo].filter(Boolean).join(" "),
  };
  result.inferred = [...inferred];
  return result;
}
