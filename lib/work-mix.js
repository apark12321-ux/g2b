// 과업 구성: 이 공고가 '무슨 일을 얼마나' 요구하는지를 문서에 적힌 대로만 나눈다.
// 업종을 가리지 않는다 — 청소·공사·물품·연구 무엇이든 그 공고의 과업 이름 그대로 비중을 낸다.

const nz = (s) => String(s || "").replace(/\s+/g, "");

/* ── 과업 줄 고르기 ──
   공고문에는 수행할 일이 아닌 줄이 섞여 있다. 이런 줄은 비중 계산에서 뺀다. */
// 발주기관이 '주는 것', 과업에서 '빠진 것'
const NOT_TASK = /(발주기관제공|제공자료|지급자재|관급|기제공|기개발|과업에포함되지않|포함하지않|제외함|해당없음|참고자료)/;
// 아래 항목을 되풀이하는 요약 줄 (같은 수량이 두 번 세 번 셈되는 것을 막음)
const SUMMARY = /^[◦ㆍ·○●▶\-*\s]*(사업내용|과업내용|사업개요|과업개요|사업명|추진배경|추진목적|목적)\s*[:：]/;

/* 납품물 수량의 단위. '교과·기관·명' 같은 범위 표현은 납품 수량이 아니므로 넣지 않는다
   (23개 기관 대상 교육 95회 → 95회가 수량, 23은 범위). */
const UNIT = /(\d[\d,]*)\s*(차시|편|종|과정|강좌|강의|코스|회|건|식|대|개소|권|부|명분|식분|㎡|m2|km|톤|EA|set)/gi;

/** 한 줄이 말하는 납품 수량 — 줄 안의 숫자를 더하지 않고 가장 큰 것 하나만 본다 */
function amountOf(line) {
  let max = 0, unit = "";
  for (const m of line.matchAll(UNIT)) {
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0 && n <= 100000 && n > max) { max = n; unit = m[2].toLowerCase(); }
  }
  return { n: max, unit };
}

const short = (l, n = 40) => { const t = String(l || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/**
 * 과업 구성 산정 — 공고마다 과업이 다르므로 고정 분류를 쓰지 않고, 문서에 적힌 과업 그대로 나눈다.
 *  AI : 문서의 수량·금액·작업량을 근거로 AI가 나눈 비중 (a.work_mix)
 *  수량: 과업 줄마다 수량이 적혀 있으면 수량 비율
 *  항목: 수량이 없으면 과업 항목 수로 (5% 단위, 대략치)
 *  → { mix: [{key,label,hint,pct,why[]}], basis, level, exact, top, topLabel }
 */
export function workMix(bid = {}, a = {}, docText = "") {
  // 1) AI가 문서 근거로 나눈 비중
  const ai = (Array.isArray(a.work_mix) ? a.work_mix : [])
    .map((x) => ({ label: short(x?.part || x?.label, 36), pct: Number(x?.pct), why: String(x?.basis || "").trim() }))
    .filter((x) => x.label && Number.isFinite(x.pct) && x.pct > 0);
  if (ai.length >= 1) {
    const total = ai.reduce((t, x) => t + x.pct, 0);
    let mix = ai.map((x, i) => ({ key: `p${i}`, label: x.label, hint: "", why: x.why && x.why !== "문서에 없음" ? [short(x.why, 120)] : [],
      pct: Math.round((x.pct / total) * 100) }))
      .sort((x, y) => y.pct - x.pct);
    if (mix.length > 6) {
      const rest = mix.slice(5);
      mix = [...mix.slice(0, 5), { key: "rest", label: "그 밖의 과업", hint: rest.map((x) => x.label).join(", "), why: [], pct: rest.reduce((t, x) => t + x.pct, 0) }];
    }
    const diff = 100 - mix.reduce((t, x) => t + x.pct, 0);
    if (diff && mix.length) mix[0].pct += diff;
    mix = mix.filter((x) => x.pct > 0);
    const exact = ai.some((x) => /\d/.test(x.why));
    return { mix, level: "AI", exact, basis: exact ? "문서에 적힌 수량·금액·작업량 기준" : "문서의 과업 내용 기준 — 분량이 적혀 있지 않아 대략치",
      top: mix[0]?.key || null, topLabel: mix[0]?.label || null };
  }

  // 2) 규칙: 문서의 과업·납품물 줄을 그대로 항목으로
  const raw = [...(a.tasks || []), ...(a.deliverables || [])]
    .map((l) => String(l || "").replace(/^[◦ㆍ·○●▶\-*\s\d.)]+/, "").trim());
  const seen = new Set();
  const lines = raw.filter((l) => {
    const k = nz(l);
    if (k.length < 4 || seen.has(k) || NOT_TASK.test(k) || SUMMARY.test(l) || /원문\s*확인/.test(l)) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);
  if (lines.length < 2) return null; // 과업을 두 가지 이상 확인하지 못하면 비율을 내지 않는다

  const amts = lines.map((l) => amountOf(nz(l)));
  // 단위가 같은 수량끼리만 비교한다 (㎡와 회를 더하면 의미가 없음)
  const byQty = amts.every((x) => x.n > 0) && new Set(amts.map((x) => x.unit)).size === 1 && new Set(amts.map((x) => x.n)).size > 1;
  const weight = byQty ? amts.map((x) => x.n) : lines.map(() => 1);
  const total = weight.reduce((t, x) => t + x, 0);
  let mix = lines.map((l, i) => ({ key: `p${i}`, label: short(l, 36), hint: "", why: [short(l, 120)],
    pct: Math.max(1, Math.floor((weight[i] / total) * 100)) }));
  for (let i = 0, left = 100 - mix.reduce((t, x) => t + x.pct, 0); left > 0; i = (i + 1) % mix.length, left--) mix[i].pct++;
  mix.sort((x, y) => y.pct - x.pct);
  mix = mix.filter((x) => x.pct > 0);
  return {
    mix, level: byQty ? "수량" : "항목", exact: byQty,
    basis: byQty ? `과업에 적힌 수량 기준 (${amts.map((x) => x.n + x.unit).join(" · ")})` : `과업 항목 ${lines.length}개 기준 — 분량이 적혀 있지 않아 대략치`,
    top: mix[0]?.key || null, topLabel: mix[0]?.label || null,
  };
}

/**
 * 선투자(선금) 가능 여부 — 대금 조건에서 판단
 *  → { level: "가능"|"일부"|"불가"|"미확인", why, pct }
 */
export function prepayLevel(payment) {
  const p = payment || {};
  if (p.advance?.has) return { level: "가능", pct: p.advance.pct || null, why: p.advance.text || "문서에 선금 조항 있음" };
  if (p.advance && p.advance.has === false) return { level: "불가", why: p.advance.text || "문서에 선금 미지급 명시" };
  if (p.progress) return { level: "일부", why: p.progress.text || "기성(중간 지급) 조항 있음" };
  if (p.documented) return { level: "불가", why: "지급 조건은 있으나 선금·기성 조항 없음 (완료 후 지급)" };
  return { level: "미확인", why: "읽은 문서에 대금 지급 조건이 없음" };
}
