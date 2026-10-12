// 유사용역 수행실적 요건 — 입찰 가능 여부를 가르는 조건이라 따로 자세히 뜯어본다.
// 문서에 적힌 것만 쓴다. 판단이 안 서면 '미상'으로 두고 원문을 그대로 보여 준다.
//
// 공고문에서 실적은 대개 네 가지 중 하나로 나온다.
//   자격   — "…실적 1건 이상 보유 업체" (참가 자격 목록) → 못 채우면 입찰 불가
//   배점   — "주요 사업 실적(10점)", "유사분야 사업 수행실적 평가 5" → 감점 감수하고 참가 가능
//   제안서 — "유사 사업실적 제시", 서식 '주요사업실적' → 제안서에 적고 정성평가 참고
//   없음   — "수행실적으로 입찰참가자격을 제한하지 않음" → 오히려 유리한 사실

const cut = (x, n = 200) => { const t = String(x || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;
const sq = (s) => String(s || "").replace(/\s+/g, "");

/** 금액 표현 → 원. "3억원", "4천만 원", "4,000만원", "40,000,000원" */
function moneyIn(line) {
  const t = String(line).replace(/,/g, "");
  let m = t.match(/(\d+(?:\.\d+)?)\s*억\s*(\d+)\s*천만/);
  if (m) return Math.round(Number(m[1]) * 1e8 + Number(m[2]) * 1e7);
  m = t.match(/(\d+(?:\.\d+)?)\s*억/);
  if (m) return Math.round(Number(m[1]) * 1e8);
  m = t.match(/(\d+(?:\.\d+)?)\s*천\s*만/);
  if (m) return Math.round(Number(m[1]) * 1e7);
  m = t.match(/(\d+(?:\.\d+)?)\s*백\s*만/);
  if (m) return Math.round(Number(m[1]) * 1e6);
  m = t.match(/(\d{2,})\s*만\s*원/);
  if (m) return Number(m[1]) * 1e4;
  m = t.match(/(\d{7,})\s*원/);
  if (m) return Number(m[1]);
  return null;
}

// 실적 이야기가 아닌 줄 — 목차(점선), 월간 보고 항목
const NOISE = /(…{3,}|\.{5,}|·{5,}|당월|진행\s*정도|월간\s*보고|업무수행\s*실적\s*및\s*진행)/;
// '실적을 묻지 않는다'는 문장
const NEG = /(제한하지\s*않|사용하지\s*않|적용하지\s*않|반영하지\s*않|요구하지\s*않|평가하지\s*않|불이익을\s*주지\s*않|묻지\s*않|무관|불문|제한\s*없|요건\s*없)/;
// 평가·우대 쪽 말 — 이게 붙으면 참가 자격이 아니다
const EVAL = /(평가|반영|가점|감점|우대|배점|점수|\d+\s*점)/;

/**
 * files: [{ name, text }]
 * → null (문서에 실적 이야기가 없음) | { kind, note, required, rows[], lines[], gate }
 */
export function recordReq(files) {
  const docs = (files || [])
    .map((f) => ({
      name: f.name,
      lines: String(f.text || "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 4 && l.length <= 500),
    }))
    .sort((a, b) => (/입찰\s*공고|공고서|공고문/.test(b.name) ? 1 : 0) - (/입찰\s*공고|공고서|공고문/.test(a.name) ? 1 : 0));
  if (!docs.length) return null;

  // 실적 문장 모으기 — PDF 줄바꿈으로 잘린 조각은 버리고 긴 쪽을 남긴다
  let all = [];
  for (const d of docs) for (const l of d.lines) {
    if (!/실적|수행\s*경험/.test(l) || NOISE.test(l)) continue;
    all.push({ line: l, key: sq(l), source: d.name });
  }
  all = all.filter((x, i) => !all.some((y, j) => j !== i && y.key.length > x.key.length && (y.key.includes(x.key) || y.key.endsWith(x.key.slice(-12)))));
  const seen = new Set();
  all = all.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
  if (!all.length) return null;

  const find = (re, not) => all.find((x) => re.test(x.line) && (!not || !not.test(x.line))) || null;
  const findAll = (re, not) => all.filter((x) => re.test(x.line) && (!not || !not.test(x.line)));
  const rows = [];
  const add = (label, h, value) => { if (h && value) rows.push({ label, value, quote: cut(h.line, 260), source: h.source }); };

  // ── 성격 판정 ─────────────────────────────────────────
  const negs = findAll(NEG);
  const negGate = negs.find((x) => /(참가\s*자격|입찰\s*참가|자격)/.test(x.line));
  const negScore = negs.find((x) => /(평가|가\s*[·ㆍ.]?\s*감점|가점|감점|배점|점수|불이익)/.test(x.line));

  const gateLine =
    find(/실적[^.]{0,40}(보유|있는)\s*(업체|자|기관|사업자)/, EVAL) ||
    find(/실적[^.]{0,60}(없는\s*경우|미달|미충족|참가\s*불가|자격\s*없|제한한다|제한함)/, NEG) ||
    find(/(참가\s*자격|입찰\s*참가\s*자격)[^.]{0,80}실적/, NEG);

  // 배점: "실적(10점)", "수행실적(5)", "실적 평가(최근 3년) 5", "실적 … 10"
  let scorePts = null, scoreLine = null;
  for (const x of all) {
    if (NEG.test(x.line)) continue;
    const m =
      x.line.match(/실적[^.]{0,30}\(\s*(\d{1,2}(?:\.\d)?)\s*점?\s*\)/) ||
      x.line.match(/실적[^.]{0,40}?(\d{1,2}(?:\.\d)?)\s*점/) ||
      x.line.match(/(?:실적|수행\s*경험)[^\d]{0,40}\s(\d{1,2}(?:\.\d)?)\s*$/);
    if (m && Number(m[1]) > 0 && Number(m[1]) <= 50) { scoreLine = x; scorePts = Number(m[1]); break; }
  }
  if (!scoreLine) scoreLine = find(/실적[^.]{0,50}(배점|정량\s*평가|가점|감점|평가\s*점수|건수\s*평가)/, NEG) || find(/(배점|정량\s*평가)[^.]{0,50}실적/, NEG);
  const bonusLine = find(/실적[^.]{0,40}(가점|우대)/, NEG);
  const qualLine = find(/실적[^.]{0,60}(정성\s*평가|반영할\s*수)/, NEG);
  const proposeLine = find(/실적[^.]{0,30}(제시|기재|작성)|서식[^.]{0,10}(주요\s*)?사업\s*실적|사업\s*수행\s*실적\s*\(최근/, NEG);

  const clearGate = !!negGate && !gateLine;
  const clearScore = !!negScore && /평가|감점|가점|불이익/.test(negScore.line) && !scoreLine;

  const kind =
    clearGate && clearScore ? "없음"
    : gateLine && scoreLine ? "둘다"
    : gateLine ? "자격"
    : scoreLine ? "배점"
    : clearGate ? "자격아님"
    : qualLine || proposeLine ? "제안서"
    : "미상";

  // ── 조건 하나하나 ──────────────────────────────────────
  // ① 인정 기간 — "최근 3년", "3년 이내", "’23~’25", "2023.01.01.~2025.12.31. 종료", "공고일 기준"
  const pLine = find(/최근\s*\d+\s*(년|개월)|\d+\s*년\s*(이내|간)/);
  if (pLine) {
    const n = pLine.line.match(/최근\s*(\d+)\s*(년|개월)/) || pLine.line.match(/(\d+)\s*(년)\s*(?:이내|간)/);
    const parts = [`최근 ${n[1]}${n[2]}`];
    const win = (find(/20\d{2}\s*[.\-/년]\s*\d{1,2}[^~∼]{0,30}(~|∼|부터)[^.]{0,30}20\d{2}/) || {}).line;
    const wm = win && win.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})?[^0-9]{1,30}?(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})?/);
    const ym = all.map((x) => x.line.match(/[‘'’](\d{2})\s*년?\s*[~∼]\s*[‘'’](\d{2})/)).find(Boolean);
    if (wm) parts.push(`${wm[1]}.${wm[2]}${wm[3] ? "." + wm[3] : ""} ~ ${wm[4]}.${wm[5]}${wm[6] ? "." + wm[6] : ""}`);
    else if (ym) parts.push(`’${ym[1]}~’${ym[2]}`);
    if (find(/(입찰\s*)?공고일\s*기준/)) parts.push("공고일 기준");
    if (find(/(미완료|종료된)[^.]{0,40}(기재하지\s*않|인정하지\s*않|제외|불인정|만을?\s*기재)|종료된[^.]{0,30}계약/)) parts.push("완료된 계약만 (진행 중 제외)");
    else if (find(/수행\s*\(?\s*수주\s*포함\s*\)?\s*중인\s*사업/)) parts.push("진행 중 사업은 계약서 사본으로 인정");
    add("인정 기간", pLine, parts.join(" · "));
  }

  // ② 금액 기준 — '단일(건당)'이냐 '합산'이냐가 실무에서 제일 많이 걸린다
  const amtLine = find(/(억|천\s*만|백\s*만|\d{2,}\s*만\s*원|\d{7,}\s*원)[^.]{0,20}(이상|초과)/) || find(/(이상|초과)[^.]{0,10}(억|천\s*만|만\s*원)/);
  const amt = amtLine ? moneyIn(amtLine.line) : null;
  const singleLine = find(/(단일\s*(계약|실적|사업)?|단위\s*계약|건당|계약\s*건\s*당|1\s*건\s*당|한\s*건\s*당)/);
  const sumLine = find(/(합산|누계|합계|총액|\(\s*단위\s*:\s*원\s*\))/);
  if (singleLine && (amt || /금액|원/.test(singleLine.line))) {
    add("금액 기준", singleLine, `한 계약당${amt ? ` ${won(amt)} 이상` : ""} — 작은 계약 여러 건을 더해 채울 수 없음`);
  } else if (sumLine) {
    add("금액 기준", sumLine, `계약 금액 합산으로 봄${amt ? ` · ${won(amt)} 이상` : ""}`);
  } else if (amtLine && amt) {
    add("금액 기준", amtLine, `${won(amt)} 이상${/VAT\s*포함|부가세\s*포함/i.test(amtLine.line) ? " (VAT 포함)" : ""}`);
  }
  if (singleLine && /건수/.test(singleLine.line)) add("평가 방식", singleLine, "기준을 넘는 계약이 몇 건인지로 평가 (금액 합계가 아님)");
  else { const cntEval = find(/실적\s*건수|건수\s*평가/); if (cntEval) add("평가 방식", cntEval, "실적 건수로 평가"); }

  // ③ 건수 기준
  const cnt = find(/\d+\s*건\s*이상/);
  if (cnt) add("건수 기준", cnt, `${cnt.line.match(/(\d+)\s*건\s*이상/)[1]}건 이상`);

  // ④ 인정 범위 — 어떤 일을 '유사'로 보는가
  let scopeVal = null, scopeLine = null;
  const only = find(/실적만\s*인정/);
  if (only) { scopeLine = only; scopeVal = cut(only.line.replace(/^[※*\s]+/, "").replace(/\.$/, ""), 160); }
  if (!scopeVal) {
    for (const x of all) {
      const m = x.line.match(/\(([^()]*실적\s*중[^()]*)\)/) || x.line.match(/([^()]{0,60}실적\s*중\s*[^.,()]{4,60})/)
        || x.line.match(/유사\s*(?:용역|사업|분야)\s*\(([^)]{4,60})\)/);
      if (m) { scopeLine = x; scopeVal = cut(m[1], 140); break; }
    }
  }
  if (!scopeVal) {
    const sl = find(/(대상|분야)[^.]{0,40}(콘텐츠|영상|이러닝|e-?러닝|교육|강의|K-?MOOC|행사|용역)[^.]{0,40}실적/i)
      || find(/(콘텐츠|영상|이러닝|e-?러닝|K-?MOOC)[^.]{0,30}(제작|개발)[^.]{0,30}실적/i);
    if (sl) { scopeLine = sl; scopeVal = cut(sl.line.replace(/^[^가-힣A-Za-z]+/, ""), 160); }
  }
  if (scopeVal) add("인정 범위", scopeLine, scopeVal);

  // ⑤ 발주처 제한 — 공공·대학 대상 실적만 쳐주는 경우 (민간 실적이 많으면 치명적)
  const orgLine = find(/(공공기관|국가기관|지방자치단체|정부투자기관|공기업|대학교?|교육기관|교육연구기관)[^.]{0,30}(대상|발주|실적)/);
  if (orgLine) {
    const kinds = [...new Set((orgLine.line.match(/(공공기관|국가기관|지방자치단체|정부투자기관|공기업|대학교|대학|교육연구기관|교육기관|기업)/g) || []))];
    add("발주처 제한", orgLine, `${kinds.join("·")} 대상 실적만 해당 — 민간 실적은 인정되지 않을 수 있음`);
  }

  // ⑥ 공동수급·하도급 실적
  const jvNo = find(/\(?\s*공동\s*(수급|도급)?\s*(및|·|,)?\s*하도급\s*(실적)?\s*제외/);
  if (jvNo) add("공동·하도급 실적", jvNo, "공동수급·하도급으로 한 실적은 인정하지 않음 — 단독 원도급 실적만");
  else {
    const jv = find(/(공동수급|구성원|컨소시엄)[^.]{0,50}실적|실적[^.]{0,30}(지분율|출자\s*비율)/);
    if (jv) add("공동수급 실적", jv, "구성원 실적 합산·지분율 반영 조건 — 협정 전에 확인");
    const sub = find(/하도급[^.]{0,40}(실적|인정|제외)/);
    if (sub) add("하도급 실적", sub, cut(sub.line, 140));
  }

  // ⑦ 증빙 — 누가 발급한 무엇만 인정하는지, 안 내면 어떻게 되는지
  const strict = find(/(발주\s*기관|본교|해당\s*기관)[^.]{0,20}(발급|발행|날인)[^.]{0,40}실적\s*증명/) || find(/실적\s*증명서\s*외[^.]{0,20}(불인정|인정하지\s*않|인정치\s*않)/);
  const penalty = find(/(미\s*첨부|첨부하지\s*않은?|제출하지\s*않은?)[^.]{0,40}(인정하지\s*않|인정치\s*않|불인정|미부여|0점)/);
  const proof = find(/실적\s*증명(서|원)|계약서\s*사본|세금계산서/);
  const proofParts = [];
  if (strict) {
    const who = /본교/.test(strict.line) ? "본교(발주기관)" : "발주기관";
    const how = (strict.line.match(/발급|발행|날인/) || [])[0];
    proofParts.push(how ? `${who}이 ${how}한 실적증명서만 인정` : "실적증명서 외 서류는 인정 안 됨");
  }
  if (penalty) proofParts.push(/미부여|0점/.test(penalty.line) ? "안 내면 해당 점수 0점" : "증빙 없는 실적은 인정 안 됨");
  if (find(/조달청[^.]{0,20}실적\s*증명/)) proofParts.push("조달청 계약 건은 조달청 실적증명서로 대체 가능");
  if (find(/수행\s*\(?\s*수주\s*포함\s*\)?\s*중인\s*사업[^.]{0,30}계약서/)) proofParts.push("진행 중 사업은 계약서 사본");
  const proofLine = strict || penalty || proof;
  if (proofLine) add("증빙 서류", proofLine, proofParts.length ? proofParts.join(" · ") : cut(proofLine.line.replace(/^[※*\s\d.)]+/, ""), 140));

  // ⑧ 판정 근거 줄
  if (gateLine) add("참가 자격", gateLine, "실적이 참가 자격 — 못 채우면 입찰 자체가 불가");
  else if (negGate) add("참가 자격", negGate, "실적으로 참가 자격을 제한하지 않음 (문서 명시)");
  if (scoreLine) add("평가 배점", scoreLine, scorePts ? `정량 평가 ${scorePts}점` : "정량 평가에 반영");
  else if (clearScore) add("평가 반영", negScore, "실적을 평가 가·감점에 쓰지 않음 (문서 명시)");
  if (bonusLine && bonusLine !== scoreLine) add("가점·우대", bonusLine, cut(bonusLine.line.replace(/^[※*\s]+/, ""), 120));
  if (qualLine && qualLine !== scoreLine) add("정성 평가", qualLine, "실적이 있으면 정성평가에서 반영될 수 있음");
  if (kind === "제안서" && proposeLine) add("제안서", proposeLine, "제안서에 유사 실적을 적고 증빙을 붙여야 함 — 정성평가 참고");

  if (!rows.length) for (const x of all.slice(0, 3)) rows.push({ label: "관련 문구", value: cut(x.line, 170), quote: cut(x.line, 260), source: x.source });

  const amountRow = rows.find((r) => r.label === "금액 기준");
  const note =
    kind === "없음" ? "실적 제한이 없습니다. 참가 자격도 아니고 평가 가·감점에도 쓰지 않는다고 문서에 적혀 있습니다."
    : kind === "자격아님" ? "실적으로 참가 자격을 제한하지 않는다고 적혀 있습니다. 평가 반영 여부는 문서에서 확인되지 않았습니다."
    : kind === "자격" ? "실적이 참가 자격입니다. 아래 조건을 하나라도 못 채우면 입찰에 들어갈 수 없습니다."
    : kind === "둘다" ? "실적이 참가 자격이면서 평가 점수에도 들어갑니다. 자격을 넘겨도 실적이 적으면 감점입니다."
    : kind === "배점" ? `참가 자격은 아니고 평가 점수${scorePts ? ` ${scorePts}점` : ""}에 들어갑니다. 실적이 모자라면 그만큼 감점입니다.`
    : kind === "제안서" ? "참가 자격·정량 배점 문구는 없고, 제안서에 유사 실적을 적어 내도록 되어 있습니다 (정성평가 참고)."
    : "실적 문구는 있으나 자격 제한인지 배점인지 문서만으로 판단되지 않습니다. 아래 원문을 확인하세요.";

  return {
    kind, note, required: kind === "자격" || kind === "둘다",
    rows,
    lines: all.slice(0, 12).map((x) => ({ quote: cut(x.line, 260), source: x.source })),
    gate: {
      ok: kind === "없음" || kind === "자격아님" || kind === "배점" || kind === "제안서" ? true : null,
      text:
        kind === "자격" || kind === "둘다" ? `유사용역 실적 요건 충족 — ${amountRow?.value || "문서의 실적 조건"}`
        : kind === "없음" || kind === "자격아님" ? "유사용역 실적 — 참가 자격 제한 없음 (문서 명시)"
        : "유사용역 실적 — 참가 자격은 아님 (평가·제안서 반영)",
    },
  };
}
