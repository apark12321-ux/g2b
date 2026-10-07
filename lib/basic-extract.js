// AI 없이 문서에서 주요 항목을 찾아 뽑는 규칙 기반 추출
const SECTIONS = {
  purpose: ["사업 목적", "사업목적", "추진 목적", "추진목적", "추진 배경", "추진배경", "사업 배경"],
  tasks: ["과업 내용", "과업내용", "과업 범위", "과업범위", "과업의 범위", "과업의 내용", "사업 내용", "사업내용", "사업 범위", "사업범위", "주요 업무", "수행 업무", "수행업무", "주요 과업", "주요과업", "세부 과업", "세부과업", "세부 추진", "세부 내용", "주요 내용", "용역 내용", "용역내용", "용역 범위", "용역범위", "과업 지시", "과업지시", "제작 내용", "제작내용", "제작 범위", "추진 내용", "추진내용", "요구 사항", "요구사항", "기능 요구"],
  staff: ["투입 인력", "투입인력", "참여 인력", "참여인력", "인력 구성", "인력구성", "수행 인력", "수행인력", "인력 투입", "인력 요건", "인력요건", "전담 인력", "필수 인력", "인력 배치", "조직 구성", "수행 조직"],
  deliverables: ["납품물", "산출물", "납품 목록", "납품목록", "제출물", "최종 결과물", "결과물", "납품 내역", "납품내역", "최종 산출물", "납품 사항", "납품사항", "제출 자료", "제작 수량", "제작물", "제작 분량", "제작 규격"],
  eligibility: ["입찰 참가자격", "입찰참가자격", "참가 자격", "참가자격", "입찰참가 자격", "입찰 참가 자격", "참가자격 요건", "자격 요건"],
  evaluation: ["평가 방법", "평가방법", "낙찰자 결정", "낙찰자결정", "제안서 평가", "평가 기준", "평가기준", "계약 방법", "계약방법", "낙찰자 선정", "협상 적격자"],
  cautions: ["유의 사항", "유의사항", "기타 사항", "특기 사항", "특기사항"],
};

const HEAD = /^\s*(?:[0-9]{1,2}[.)]|[가-하][.)]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.)]?|[①-⑳]|□|■|◎|○|\(\d+\))\s*/;

const TOC = /^(?:\d{1,2}\.|[가-하]\.|\d{1,2}\)|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\.?)?\s*[^\d].{1,40}?\s+\d{1,3}$/;
export function dropToc(text) {
  return String(text || "")
    .split(/\n/)
    .filter((l) => { const t = l.replace(/\s+/g, " ").trim(); return !(TOC.test(t) && t.length <= 50) && !/^목\s*차$/.test(t); })
    .join("\n");
}
function linesOf(text) {
  return dropToc(text).split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// 제목 줄 다음에 오는 몇 줄을 뽑음 (같은 급의 다음 제목이 나오면 멈춤)
function section(lines, heads) {
  const n = (s) => s.replace(/\s+/g, "");
  for (let i = 0; i < lines.length; i++) {
    const ln = n(lines[i]);
    if (ln.length > 40) continue; // 제목은 짧음
    if (!heads.some((h) => ln.includes(n(h)))) continue;
    const out = [];
    const rest = lines[i].split(/[:：]/).slice(1).join(":").trim();
    if (rest) out.push(rest);
    const topLevel = /^\s*(?:[0-9]{1,2}[.)]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])/.test(lines[i]);
    for (let j = i + 1; j < lines.length && out.length < 8; j++) {
      const l = lines[j];
      if (topLevel && /^\s*(?:[0-9]{1,2}[.)]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])\s*\S/.test(l)) break;
      if (Object.values(SECTIONS).flat().some((h) => n(l).length <= 40 && n(l).includes(n(h)) && !heads.includes(h))) break;
      out.push(l.replace(HEAD, "").slice(0, 160));
    }
    if (out.length) return out;
  }
  return [];
}

function find(text, re) {
  const m = text.match(re);
  return m ? m[0].replace(/\s+/g, " ").trim().slice(0, 160) : "";
}

// 발표 관련 조건: 줄바꿈으로 끊긴 문장을 이어 붙인 뒤, 발표 관련 문장만 골라냄
const PRESENT = /(발표자|대리\s*발표|직접\s*발표|발표\s*(?:는|은|를|시간|순서|장소|일시|방법|자료|인원|대상|자격)|제안\s*(?:설명|발표|평가\s*발표)|프레젠테이션|(?:^|[^A-Za-z])PT(?:[^A-Za-z]|$)|질의\s*응답|발표\s*후|발표회|참석\s*인원)/;
const NOT_PRESENT = /(결과|합격|선정|낙찰|순위|우선협상\s*대상자?)\s*(?:를|을|은|는|의)?\s*(?:공고|발표|통보)/;

export function sentencesOf(text) {
  const lines = text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const merged = [];
  for (const l of lines) {
    const prev = merged[merged.length - 1];
    // 앞 줄이 문장 끝(다/함/음/임/것/:)으로 끝나지 않고, 지금 줄이 새 항목이 아니면 이어 붙임
    if (prev && !/[다함음임것.:：)]\s*$/.test(prev) && !HEAD.test(l) && prev.length < 300) merged[merged.length - 1] = prev + " " + l;
    else merged.push(l);
  }
  return merged
    .flatMap((l) => l.split(/(?<=[다함음임]\.)\s+|(?<=[다함음임])\s+(?=[가-하]\.|\d+\.)/))
    .map((x) => x.replace(HEAD, "").trim())
    .filter(Boolean);
}

export function presentationOf(text) {
  const seen = new Set();
  const out = [];
  for (const s of sentencesOf(text)) {
    if (!PRESENT.test(s) || NOT_PRESENT.test(s)) continue;
    const key = s.replace(/\s+/g, "");
    if (seen.has(key) || key.length < 6) continue;
    seen.add(key);
    out.push(s.length > 220 ? s.slice(0, 219) + "…" : s);
  }
  // 발표자 자격·대리 발표 문장을 앞으로
  const w = (x) => (/발표자|대리|직접|사업책임자|PM|책임/.test(x) ? 0 : 1);
  return out.sort((a, b) => w(a) - w(b)).slice(0, 8);
}

/** texts: [{name, text}] → 분석 결과와 같은 모양 */
export function basicExtract(texts, bid = {}) {
  // 제안요청서를 맨 앞에: 가장 중요한 문서
  const ordered = [...texts].sort((x, y) => (/제안요청/.test(y.name) ? 1 : 0) - (/제안요청/.test(x.name) ? 1 : 0));
  const all = dropToc(ordered.map((t) => t.text).join("\n"));
  const lines = linesOf(all);
  const out = { mode: "basic" };
  for (const [k, heads] of Object.entries(SECTIONS)) out[k] = section(lines, heads);

  out.presentation = presentationOf(all);
  const sents = sentencesOf(all);
  const kv = (label) => {
    const m = all.match(new RegExp(`(?:^|\\n)\\s*[◦○ㅇ·•\\-]?\\s*${label}\\s*[:：]\\s*([^\\n]{3,200})`));
    return m ? m[1].trim() : "";
  };
  // 개요의 '사업내용 : …' 은 무엇을 몇 개 만드는지가 한 줄로 적혀 있어 가장 확실함
  out.scope = kv("(?:사업\\s*내용|과업\\s*내용|개발\\s*내용|주요\\s*내용|사업\\s*규모|개발\\s*규모)");
  const scopeItems = out.scope ? out.scope.split(/\s*[,，;]\s*(?![^()]*\))/).map((x) => x.trim()).filter((x) => x.length > 3) : [];
  const overview = kv("(?:제안\\s*요청\\s*개요)");
  const intro = (all.match(/본\s*(?:사업|과업|용역)은\s*[^\n]{10,160}?(?:이다|함|한다|임)\./) || [])[0];

  // 수행사(개발기관) 역할 목록이 있으면 그게 곧 '하는 일'
  const roleIdx = linesOf(all).findIndex((l) => /^(개발\s*기관|수행\s*기관|계약\s*상대자|개발\s*사업자|수행사|용역\s*수행\s*기관)$/.test(l));
  if (roleIdx >= 0) {
    const ls = linesOf(all);
    const items = [];
    for (let j = roleIdx + 1; j < ls.length && items.length < 10; j++) {
      if (/^[◦○ㅇ·•\-]/.test(ls[j])) items.push(ls[j].replace(/^[◦○ㅇ·•\-]\s*/, ""));
      else if (items.length) break;
    }
    if (items.length >= 2) out.tasks = items.filter((x) => !/(일정\s*계획|진도|인력\s*관리)/.test(x)).slice(0, 8);
  }
  if (scopeItems.length) {
    out.deliverables = [...scopeItems, ...linesOf(all).filter((l) => /^\(분량\)/.test(l)).map((l) => l.replace(/^\(분량\)\s*/, "분량: "))].slice(0, 6);
    if (!out.tasks.length) out.tasks = scopeItems;
  }
  if (intro || overview) out.purpose = [intro || overview];
  // 분량 문장: 원가 계산용 (강좌·주차·차시·편·분)
  out.qty = [...new Set(linesOf(all).filter((l) => /\d/.test(l) && /(강좌|주차|차시|편|분\s*(내외|이상|이내)|러닝타임|학습\s*시간)/.test(l) && l.length <= 160))].slice(0, 15);
  // 투입 인력: 역할·인원이 적힌 줄만 (표 칸 조각·요구사항 번호 제외)
  out.staff = (out.staff || []).filter((x) => /(\d+\s*(명|인|MM|M\/M)|PM|책임|PD|감독|작가|기획자|디자이너|편집자|개발자|연구원|교수설계자)/.test(typeof x === "string" ? x : x.role || ""));
  const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = x.replace(/\s+/g, ""); if (seen.has(k)) return false; seen.add(k); return true; }); };

  // 수행 업무 제목을 못 찾으면: 업무 동사가 들어간 문장을 골라 씀
  if (!out.tasks.length) {
    const VERB = /(제작|촬영|편집|개발|기획|구성|설계|운영|구축|번역|녹음|자막|업로드|탑재|홍보|송출|중계|검수)/;
    const NOT = /(자격|평가|점수|제출|마감|입찰|계약|보증|낙찰|서류|등록|과징|배상|공고|문의|담당|증명|첨부)/;
    out.tasks = uniq(sents.filter((x) => VERB.test(x) && !NOT.test(x) && x.length >= 8 && x.length <= 120)).slice(0, 6);
  }
  // 참가자격 제목을 못 찾으면
  if (!out.eligibility.length) {
    out.eligibility = uniq(sents.filter((x) => /자격/.test(x) && /(업체|자|사업자|기업)/.test(x) && x.length <= 150)).slice(0, 3);
  }
  // 투입 인력 제목을 못 찾으면: 'N명' 이 붙은 역할 문장
  if (!out.staff.length) {
    out.staff = uniq(sents.filter((x) => /\d+\s*명/.test(x) && /(PM|책임|PD|감독|작가|기획|디자이너|편집|촬영|연구원|개발자|인력)/.test(x) && x.length <= 120)).slice(0, 5);
  }
  // 납품물 제목을 못 찾으면, 수량이 붙은 결과물 문장을 찾아 대신 씀
  if (!out.deliverables.length) {
    const QTY = /\d[\d,.]*\s*(?:차시|편|종|개|건|과정|권|분|부|식|회|컷|본|세트)/;
    const OBJ = /(콘텐츠|영상|동영상|교재|교안|원고|스토리보드|보고서|매뉴얼|홍보물|강의|과정)/;
    const seen = new Set();
    out.deliverables = sentencesOf(all)
      .filter((x) => QTY.test(x) && OBJ.test(x) && x.length <= 120 && !/금액|원\)|예산|기간|평가|점/.test(x))
      .filter((x) => { const k = x.replace(/\s+/g, ""); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 5);
  }
  out.period = find(all, /(?:사업|계약|용역|과업|수행|제작)\s*기간\s*[:：]?\s*[^\n]{4,80}/) || find(all, /(?:착수일|계약일|계약\s*체결일)\s*(?:로|으로)?부터\s*[^\n]{2,40}/) || find(all, /(?:사업|계약|용역|과업|수행)\s*기간\s*[:：]?\s*[^\n]{4,80}/);
  if (!out.evaluation.length) {
    const m = find(all, /(협상에\s*의한\s*계약|적격\s*심사|최저\s*가|2단계\s*경쟁|제한\s*경쟁|일반\s*경쟁)[^\n]{0,60}/);
    if (m) out.evaluation = [m];
  }
  if (!out.evaluation.length) {
    const ev = find(all, /기술\s*(?:능력)?\s*(?:평가)?\s*\d{2}\s*[:：%점]?\s*(?:,|대|:|：)?\s*가격\s*(?:평가)?\s*\d{1,2}[^\n]{0,20}/);
    out.evaluation = ev ? [ev] : [];
  }
  out.evaluation = out.evaluation.join(" / ");
  const sched = [];
  for (const re of [/제안서\s*(?:제출|접수)[^\n]{0,70}/, /제안\s*설명회[^\n]{0,70}/, /(?:제안\s*)?발표[^\n]{0,15}(?:일시|예정)[^\n]{0,50}/]) {
    const s = find(all, re);
    if (s) sched.push(s);
  }
  out.schedule = sched;
  out.staff = out.staff.map((s) => ({ role: s, detail: "" }));
  const found = ["tasks", "staff", "deliverables", "eligibility", "schedule"].filter((k) => out[k].length).length +
    (out.period ? 1 : 0) + (out.evaluation ? 1 : 0);
  // 짧은 요약 문장 (AI 없이 뽑은 항목으로 구성)
  const cut = (x, n) => (x.length > n ? x.slice(0, n - 1) + "…" : x);
  const strip = (x) => x.replace(/^(사업|추진)\s*(목적|배경)\s*[:：]?\s*/, "").replace(/^[-·•]\s*/, "");
  const budget = find(all, /(?:사업\s*예산|사업비|소요\s*예산|추정\s*금액|기초\s*금액)\s*[:：]?\s*[^\n]{3,50}/);
  const parts = [];
  if (out.purpose.length) parts.push(cut(strip(out.purpose[0]), 140));
  if (out.scope) parts.push(`과업 규모: ${cut(out.scope, 110)}`);
  if (out.tasks.length && !out.scope) {
    const t = out.tasks.slice(0, 3).map((x) => cut(x.replace(/[.。]$/, ""), 30)).join(", ");
    parts.push(`주요 과업은 ${t}${out.tasks.length > 3 ? " 등" : ""}입니다`);
  }
  const facts = [];
  if (out.period) facts.push(cut(out.period.replace(/^\S*기간\s*[:：]?\s*/, "기간 "), 50));
  if (budget) facts.push(cut(budget.replace(/\s*[:：]\s*/, " "), 45));
  if (out.staff.length) facts.push(`요구 인력 ${out.staff.length}개 항목`);
  if (facts.length) parts.push(facts.join(", "));
  out.summary = parts.length ? parts.map((x) => x.replace(/[.。]?$/, ".")).join(" ") : "";
  delete out.purpose;
  return out;
}
