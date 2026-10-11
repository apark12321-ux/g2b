// 과업 구성: 이 공고가 '무슨 일을 얼마나' 요구하는지를 문서에 적힌 대로만 나눈다.
// 여기에는 우리 사정을 넣지 않는다 — 감당 가능 여부 판단은 아래 capacityFit에서 따로 한다.

const nz = (s) => String(s || "").replace(/\s+/g, "");

export const WORK_KINDS = [
  { key: "video", label: "영상 제작", hint: "촬영·편집·모션·자막",
    re: /(영상|동영상|촬영|편집|모션그래픽|모션|애니메이션|자막|성우|내레이션|나레이션|더빙|인코딩|쇼츠|클립|브이로그|스튜디오|카메라|조명|짐벌|드론)/ },
  { key: "isd", label: "교수설계", hint: "교수설계·원고·스토리보드·평가문항",
    re: /(교수설계|교수-학습설계|교수학습설계|학습설계|ISD|스토리보드|구성안|대본|시나리오|원고|집필|교안|내용설계|학습목표|평가문항|형성평가|퀴즈|차시설계|커리큘럼|교육과정개발|콘텐츠기획|내용기획|과정설계|기획안|교수학습모형|수업모형|지도안)/i },
  { key: "dev", label: "개발·탑재", hint: "HTML5·플랫폼 탑재·시스템",
    re: /(HTML5|웹퍼블리싱|퍼블리싱|프로그래밍|개발사이트|플랫폼|LMS|학습관리|시스템|서버|탑재|업로드|연동|API|앱개발|홈페이지|반응형|상호작용)/i },
  { key: "ops", label: "교육 운영", hint: "연수·강사·행사 운영",
    re: /(교육운영|연수운영|과정운영|학습자관리|수강관리|강사섭외|강사비|튜터|멘토|행사|워크숍운영|설명회운영|모집|홍보운영)/ },
  { key: "etc", label: "교재·기타", hint: "교재·인쇄·번역·조사",
    re: /(교재|워크북|보조교재|인쇄|제본|책자|번역|외국어|수어|화면해설|실태조사|설문|연구보고서|컨설팅)/ },
];

/* ── 과업 줄 고르기 ──
   공고문에는 우리 일이 아닌 줄이 섞여 있다. 이런 줄은 비중 계산에서 뺀다. */
// 발주기관이 '주는 것', 과업에서 '빠진 것'
const NOT_TASK = /(발주기관제공|제공자료|지급자재|관급|기제공|기개발|과업에포함되지않|포함하지않|제외함|해당없음|참고자료)/;
// 아래 항목을 되풀이하는 요약 줄 (같은 수량이 두 번 세 번 셈되는 것을 막음)
const SUMMARY = /^[◦ㆍ·○●▶\-*\s]*(사업내용|과업내용|사업개요|과업개요|사업명|추진배경|추진목적|목적)\s*[:：]/;

/* 납품물 수량의 단위. '교과·기관·명' 같은 범위 표현은 납품 수량이 아니므로 넣지 않는다
   (23개 교과 대상 영상 95편 → 95편이 수량, 23은 범위). */
const UNIT = /(\d[\d,]*)\s*(차시|편|종|과정|강좌|강의|코스)/g;

/** 한 줄이 말하는 납품 수량 — 줄 안의 숫자를 더하지 않고 가장 큰 것 하나만 본다 */
function amountOf(line) {
  let max = 0;
  for (const m of line.matchAll(UNIT)) {
    const n = Number(String(m[1]).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0 && n <= 100000) max = Math.max(max, n);
  }
  return max;
}

/**
 * 과업 구성 산정 — 문서가 말해 주는 만큼만 셈한다.
 *  수량  : 나오는 업무마다 수량이 적혀 있을 때만. 같은 수량은 한 번만 셈한다
 *  항목  : 수량이 일부만 적혀 있으면 비교가 안 되므로 과업 항목 수로 (5% 단위)
 *  제목  : 문서를 못 읽었으면 비율을 내지 않는다
 *  → { mix: [{key,label,hint,pct,why[]}], basis, level, exact }
 */
export function workMix(bid = {}, a = {}, docText = "") {
  const raw = [
    ...(a.tasks || []),
    ...(a.deliverables || []),
    ...(a.qty || []),
    ...String(a.scope || "").split(/\s*[,，;]\s*(?![^()]*\))/),
  ].map((l) => String(l || "").replace(/^[◦ㆍ·○●▶\-*\s]+/, "").trim());

  // 글머리표만 다른 같은 줄은 하나로
  const seen = new Set();
  const all = raw.filter((l) => {
    const k = nz(l);
    if (k.length < 4 || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const lines = all.filter((l) => !NOT_TASK.test(nz(l)));
  const items = lines.filter((l) => !SUMMARY.test(l));
  const use = items.length >= 3 ? items : lines;   // 요약밖에 없으면 요약이라도 쓴다

  const score = Object.fromEntries(WORK_KINDS.map((k) => [k.key, 0]));
  const why = Object.fromEntries(WORK_KINDS.map((k) => [k.key, []]));
  const qtySeen = Object.fromEntries(WORK_KINDS.map((k) => [k.key, new Set()]));
  const hasQty = Object.fromEntries(WORK_KINDS.map((k) => [k.key, false]));
  let counted = 0;

  for (const line of use) {
    const t = nz(line);
    const hit = WORK_KINDS.filter((k) => k.re.test(t));
    if (!hit.length) continue;
    counted++;
    const amt = amountOf(t);
    for (const k of hit) {
      // 같은 수량(95편 등)이 여러 줄에 되풀이되면 한 번만 센다
      if (amt > 0 && !qtySeen[k.key].has(amt)) { qtySeen[k.key].add(amt); hasQty[k.key] = true; }
      score[k.key] += 1 / hit.length;              // 항목 수 기준 점수는 늘 쌓아 둔다
      if (why[k.key].length < 3) why[k.key].push(line.slice(0, 90));
    }
  }

  if (!counted) {
    const t = nz(bid.title);
    const hit = WORK_KINDS.filter((k) => k.re.test(t));
    if (!hit.length) return null;
    return {
      level: "제목", exact: false,
      basis: "공고문을 읽지 못해 공고명으로만 봄 — 비율은 산정하지 않음",
      mix: hit.map((k) => ({ key: k.key, label: k.label, hint: k.hint, pct: null, why: [] })),
      video: 0, isd: 0, dev: 0, ops: 0, etc: 0,
      top: hit[0].key, topLabel: hit[0].label,
    };
  }

  // 나오는 업무 '모두'에 수량이 적혀 있을 때만 수량으로 잰다.
  // 한쪽만 숫자가 있으면 숫자 없는 쪽이 0에 가깝게 눌려 버린다 (영상 95편 vs 교수설계 "원고 작성").
  const kinds = WORK_KINDS.filter((k) => score[k.key] > 0);
  const byQty = kinds.length > 0 && kinds.every((k) => hasQty[k.key]);
  const weight = byQty
    ? Object.fromEntries(kinds.map((k) => [k.key, [...qtySeen[k.key]].reduce((t, n) => t + n, 0)]))
    : Object.fromEntries(kinds.map((k) => [k.key, score[k.key]]));

  const total = Object.values(weight).reduce((t, x) => t + x, 0);
  if (!total) return null;

  const step = byQty ? 1 : 5;
  let mix = kinds
    .map((k) => ({
      key: k.key, label: k.label, hint: k.hint, why: why[k.key],
      pct: Math.round((weight[k.key] / total) * 100 / step) * step,
    }))
    .filter((x) => x.pct > 0)
    .sort((x, y) => y.pct - x.pct);
  if (!mix.length) return null;
  const diff = 100 - mix.reduce((t, x) => t + x.pct, 0);
  if (diff) mix[0].pct += diff;
  mix = mix.filter((x) => x.pct > 0);

  const basis = byQty
    ? `과업에 적힌 납품 수량 기준 (${kinds.map((k) => `${k.label} ${[...qtySeen[k.key]].join("+")}`).join(", ")})`
    : `과업 항목 ${counted}개 기준 — 업무마다 분량이 적혀 있지 않아 대략치`;

  const get = (k) => mix.find((x) => x.key === k)?.pct || 0;
  return {
    mix, basis, level: byQty ? "수량" : "항목", exact: byQty,
    video: get("video"), isd: get("isd"), dev: get("dev"), ops: get("ops"), etc: get("etc"),
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

/**
 * 위 과업 구성을 후미디어 사정에 대입한 판단 — 공고 분석이 아니라 '우리 쪽' 이야기다.
 *  영상 제작은 바로 가능 / 교수설계는 인력·선투자 부담 → 선금이 있으면 감당 가능
 *  → { fit: "좋음"|"보통"|"부담", headline, note, delta(점수 가감), items[] }
 */
export function capacityFit(wm, pre) {
  // 비율을 못 낸 공고(문서 미확인)는 우리 기준 판단도 하지 않는다 — 없는 근거로 점수를 매기지 않기 위함
  if (!wm || wm.level === "제목") return null;
  const items = [];              // [{ n: 점수, why: 설명 }]
  const push = (n, why) => items.push({ n, why });
  const canPrepay = pre?.level === "가능";
  const partPrepay = pre?.level === "일부";

  // 영상 제작: 바로 투입 가능한 주력 업무
  if (wm.video >= 60) push(20, `영상 제작 ${wm.video}% (주력 업무, 바로 투입 가능)`);
  else if (wm.video >= 35) push(10, `영상 제작 ${wm.video}%`);
  else if (wm.video < 15) push(-15, `영상 제작 ${wm.video}% (주력 업무 비중 낮음)`);

  // 교수설계: 인력 부족·선투자 불가 → 선금이 있어야 감당
  if (wm.isd >= 40) {
    if (canPrepay) push(5, `교수설계 ${wm.isd}%지만 선금${pre.pct ? ` ${pre.pct}%` : ""}이 있어 인력 투입 가능`);
    else if (partPrepay) push(-8, `교수설계 ${wm.isd}% · 선금 없음(기성만) — 인력 선투입 부담`);
    else push(-18, `교수설계 ${wm.isd}% · 선금 없음 — 인력 부족·선투자 불가`);
  } else if (wm.isd >= 20 && !canPrepay && !partPrepay) {
    push(-6, `교수설계 ${wm.isd}% · 선금 없음`);
  }

  if (wm.dev >= 30) push(-8, `개발·탑재 ${wm.dev}% (외주 필요)`);
  if (wm.ops >= 30) push(-10, `교육 운영 ${wm.ops}% (상시 인력 필요)`);

  const delta = items.reduce((t, x) => t + x.n, 0);
  const fit = delta >= 10 ? "좋음" : delta >= -8 ? "보통" : "부담";
  const headline =
    fit === "좋음" ? "우리 주력 업무 — 바로 투입 가능"
    : fit === "보통" ? "조건을 확인한 뒤 판단"
    : "인력·선투자 부담이 큼";
  const note = canPrepay
    ? `선금${pre.pct ? ` ${pre.pct}%` : ""}이 있어 인력을 먼저 투입할 수 있습니다.`
    : partPrepay ? "기성(중간 지급)만 있어 초기 인건비는 자체 부담입니다."
    : pre?.level === "미확인" ? "대금 조건이 문서에 없어 선금 가능 여부를 확인해야 합니다."
    : "선금이 없어 완료까지 인건비를 자체 부담해야 합니다.";
  return { fit, headline, note, delta, items, canPrepay };
}
