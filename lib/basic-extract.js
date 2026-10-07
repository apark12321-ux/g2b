// AI 없이 문서에서 주요 항목을 찾아 뽑는 규칙 기반 추출
const SECTIONS = {
  purpose: ["사업 목적", "사업목적", "추진 목적", "추진목적", "추진 배경", "추진배경", "사업 배경"],
  tasks: ["과업 내용", "과업내용", "과업 범위", "과업범위", "사업 내용", "사업내용", "주요 업무", "수행 업무", "주요 과업", "세부 과업", "주요 내용", "용역 내용", "용역내용", "과업 지시", "과업지시"],
  staff: ["투입 인력", "투입인력", "참여 인력", "참여인력", "인력 구성", "인력구성", "수행 인력", "수행인력", "인력 투입"],
  deliverables: ["납품물", "산출물", "납품 목록", "납품목록", "제출물", "최종 결과물", "결과물", "납품 내역", "납품내역", "최종 산출물"],
  eligibility: ["입찰 참가자격", "입찰참가자격", "참가 자격", "참가자격", "입찰참가 자격"],
  evaluation: ["평가 방법", "평가방법", "낙찰자 결정", "낙찰자결정", "제안서 평가", "평가 기준", "평가기준"],
  cautions: ["유의 사항", "유의사항", "기타 사항", "특기 사항", "특기사항"],
};

const HEAD = /^\s*(?:[0-9]{1,2}[.)]|[가-하][.)]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.)]?|[①-⑳]|□|■|◎|○|\(\d+\))\s*/;

function linesOf(text) {
  return text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
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

function sentencesOf(text) {
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
export function basicExtract(texts) {
  const all = texts.map((t) => t.text).join("\n");
  const lines = linesOf(all);
  const out = { mode: "basic" };
  for (const [k, heads] of Object.entries(SECTIONS)) out[k] = section(lines, heads);

  out.presentation = presentationOf(all);
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
  out.period = find(all, /(?:사업|계약|용역|과업|수행)\s*기간\s*[:：]?\s*[^\n]{4,80}/);
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
  if (out.purpose.length) parts.push(cut(strip(out.purpose[0]), 110));
  if (out.tasks.length) {
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
