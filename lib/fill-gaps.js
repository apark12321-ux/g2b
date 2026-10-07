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
// ── 품질 검사: 연락처·법조문·목차·안내문 같은 줄이 '하는 일·납품물·개요'로 나오지 않게
const JUNK = /(\d{2,4}[-)\s]\d{3,4}[-\s]\d{4}|@|담당자|문의|연락처|연구원\s*\/|행정원|주무관|법률|시행령|시행규칙|지침\s*제|조달청\s*(?:지침|공고)|청렴|갑질|공정거래|부당\s*행위|제보|익명|신고자|보안\s*(?:서약|위반)|부정당|입찰참가자격|제출\s*(?:서류|기한)|평가\s*(?:항목|위원)|배점|협상|낙찰|^\d+$|^[가-하]\.\s*\S{1,12}\s*\d{1,3}$|^\S{1,10}$)/;
const WORK = /(기획|설계|제작|촬영|편집|개발|운영|작성|구성|탑재|검수|관리|녹음|자막|디자인|구축|보급|홍보|교육|컨설팅|조사|연구|분석|집필|번역|모션|애니메이션|업로드|송출|중계|스토리보드|시나리오|강의|콘텐츠|영상)/;
const OUTPUT = /(\d|영상|콘텐츠|차시|편|강좌|보고서|교재|스토리보드|원본|파일|결과물|매뉴얼|원고|자료|산출물|패키지|책자|웹페이지)/;
const clean = (arr, need) => [...new Set((Array.isArray(arr) ? arr : arr ? [arr] : [])
  .map((x) => String(typeof x === "object" && x ? x.role || x.text || "" : x).replace(/^[◦○ㅇ·•\-\s]+/, "").trim())
  .filter((x) => x.length >= 6 && x.length <= 160 && !JUNK.test(x) && need.test(x)))];

export function fillGaps(result, bid, meta = {}, docText = "") {
  const inferred = new Set(result.inferred || []);
  // 잘못 뽑힌 줄 걸러내기 → 너무 적으면 비워서 아래에서 사업내용·공고명으로 다시 채움
  result.tasks = clean(result.tasks, WORK).slice(0, 8);
  result.deliverables = clean(result.deliverables, OUTPUT).slice(0, 8);
  if (result.scope && JUNK.test(result.scope)) result.scope = "";
  const scopeItems = result.scope ? clean(result.scope.split(/\s*[,，;]\s*(?![^()]*\))/), WORK) : [];
  if (result.tasks.length < 2 && scopeItems.length) { result.tasks = [...new Set([...result.tasks, ...scopeItems])]; }
  if (result.deliverables.length < 1 && scopeItems.length) result.deliverables = clean(scopeItems, OUTPUT);
  if (result.summary && (JUNK.test(result.summary) || String(result.summary).length < 15)) result.summary = "";
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
    const purpose = clean(result.purpose, /./)[0];
    result.summary = result.scope
      ? `${purpose ? purpose.replace(/[.。]?$/, ". ") : ""}과업 규모: ${result.scope}.`
      : `${bid.title} — ${result.tasks.slice(0, 2).join(", ")} 중심의 사업입니다.`;
    if (!result.scope) inferred.add("summary");
  }
  // 투입 시작일 = 결과 발표일 + 7일 (계약일 기준). 발표일은 문서 → 개찰일 → 입찰마감+7일 순으로 찾음
  try {
    const close = bid.close_at ? new Date(bid.close_at) : null;
    const year = (close || new Date()).getFullYear();
    const toDate = (y, mo, d) => new Date(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+09:00`);
    let rd = null, how = "";
    const m = String(docText || "").match(/(결과\s*(?:발표|통보|공지|안내)|우선\s*협상\s*대상자\s*(?:선정|발표|통보)|협상\s*적격자\s*(?:선정|발표|통보)|낙찰자\s*(?:결정|발표|선정))[^\n]{0,40}?(?:(20\d{2})\s*[.\-년]\s*)?(\d{1,2})\s*[.\-월]\s*(\d{1,2})/);
    if (m) {
      let y = m[2] ? Number(m[2]) : year;
      let d = toDate(y, Number(m[3]), Number(m[4]));
      if (!m[2] && close && d < close) d = toDate(y + 1, Number(m[3]), Number(m[4]));
      if (!isNaN(d)) { rd = d; how = "문서의 결과 발표일"; }
    }
    if (!rd && meta?.opengDt) {
      const o = new Date(String(meta.opengDt).replace(" ", "T") + "+09:00");
      if (!isNaN(o)) { rd = o; how = "개찰일"; }
    }
    if (!rd && close) { rd = new Date(close.getTime() + 7 * 864e5); how = "입찰마감 + 7일(평가 기간)"; }
    if (rd) {
      result.resultDate = rd.toISOString();
      result.contractStart = new Date(rd.getTime() + 7 * 864e5).toISOString();
      result.startBasis = `${how} + 7일`;
    }
  } catch {}

  // ── 일정 마일스톤: 자격등록 마감 · 입찰(제안서) 마감 · 제안서 제출 · 개찰 · 발표
  try {
    const toISO = (v) => { if (!v) return null; const d = new Date(String(v).replace(" ", "T") + (String(v).length <= 16 ? ":00" : "") + "+09:00"); return isNaN(d) ? null : d.toISOString(); };
    const close = bid.close_at ? new Date(bid.close_at) : null;
    const year = (close || new Date()).getFullYear();
    const fromDoc = (re) => {
      const lines = String(docText || "").split(/\n+/).filter((l) => re.test(l) && l.length < 200);
      for (const l of lines) {
        const m = l.match(/(?:(20\d{2})\s*[.\-년]\s*)?(\d{1,2})\s*[.\-월]\s*(\d{1,2})\s*[.일]?\s*(?:\([^)]{1,3}\))?\s*(?:(\d{1,2})\s*:\s*(\d{2}))?/);
        if (!m) continue;
        let y = m[1] ? Number(m[1]) : year;
        const d = new Date(`${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${(m[4] || "10").padStart(2, "0")}:${m[5] || "00"}:00+09:00`);
        if (!m[1] && close && d < new Date(close.getTime() - 60 * 864e5)) d.setFullYear(y + 1);
        if (!isNaN(d)) return d.toISOString();
      }
      return null;
    };
    const ms = {
      qualify: toISO(meta?.bidQlfctRgstDt),
      close: toISO(meta?.bidClseDt) || (close ? close.toISOString() : null),
      open: toISO(meta?.opengDt),
      submit: fromDoc(/(제안서|제안\s*서류|기술\s*제안서)[^\n]{0,15}(제출|접수|마감)/),
      present: fromDoc(/(제안\s*)?(발표|설명회|프레젠테이션|PT)\s*(?:평가)?[^\n]{0,10}(일시|일자|예정|:)/) || fromDoc(/(제안서\s*)?평가\s*(?:일시|일자|예정)/),
    };
    if (!ms.submit) ms.submit = ms.close; // 협상계약은 보통 입찰마감 = 제안서 제출 마감
    ms.presentEst = !ms.present;
    if (!ms.present && ms.close) ms.present = new Date(new Date(ms.open || ms.close).getTime() + 5 * 864e5).toISOString(); // 발표는 개찰(마감) 후 약 5일로 가정
    result.milestones = ms;
  } catch {}

  result.meta = {
    contract: m.cntrctCnclsMthdNm || "", award: m.sucsfbidMthdNm || "", tech, price,
    briefing: m.dcmtgOprtnDt ? kst(m.dcmtgOprtnDt) : "", contact: [m.ntceInsttOfclNm, m.ntceInsttOfclTelNo].filter(Boolean).join(" "),
  };
  result.inferred = [...inferred];
  return result;
}
