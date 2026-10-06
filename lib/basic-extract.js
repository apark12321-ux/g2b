// AI 없이 문서에서 주요 항목을 찾아 뽑는 규칙 기반 추출
const SECTIONS = {
  tasks: ["과업 내용", "과업내용", "과업 범위", "과업범위", "사업 내용", "사업내용", "주요 업무", "수행 업무", "주요 과업", "세부 과업"],
  staff: ["투입 인력", "투입인력", "참여 인력", "참여인력", "인력 구성", "인력구성", "수행 인력", "수행인력", "인력 투입"],
  deliverables: ["납품물", "산출물", "납품 목록", "제출물"],
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

/** texts: [{name, text}] → 분석 결과와 같은 모양 */
export function basicExtract(texts) {
  const all = texts.map((t) => t.text).join("\n");
  const lines = linesOf(all);
  const out = { mode: "basic" };
  for (const [k, heads] of Object.entries(SECTIONS)) out[k] = section(lines, heads);

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
  out.summary = found
    ? "첨부 문서에서 주요 항목을 찾아 그대로 옮겼습니다. (AI 요약 아님)"
    : "첨부 문서에서 주요 항목을 찾지 못했습니다. 첨부파일을 직접 확인해 주세요.";
  return out;
}
