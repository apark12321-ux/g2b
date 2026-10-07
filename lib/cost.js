// M/M(사람×월) 기반 원가·마진 추정
// 인건비 = 역할별 M/M × 등급별 노임단가(1일) × 월 근무일수. 기준값은 사이트의 '원가 기준 수정'에서 바꿀 수 있음.

// 엔지니어링기술자 노임단가 (한국엔지니어링협회, 2025년 적용, '기타' 부문, 1인 1일)
export const LABOR = { 중급: 246345, 초급: 219507, days: 20.5, source: "엔지니어링 노임단가(2025년 적용·기타 부문)" };

// 산출물 1단위당 투입 M/M 과 역할 배분 (중급/초급)
export const UNIT = {
  차시: {
    label: "이러닝 차시(25분 내외)", mm: 0.25, direct: 200000, facility: 150000,
    roles: [["PM", "중급", 0.1], ["교수설계·원고", "중급", 0.3], ["촬영", "초급", 0.15], ["편집", "초급", 0.2], ["디자인·모션", "초급", 0.15], ["개발·검수", "초급", 0.1]],
  },
  편: {
    label: "영상 제작(기획·촬영·편집, 5분 기준)", mm: 0.8, direct: 2000000, facility: 1200000,
    roles: [["PM", "중급", 0.1], ["기획·작가", "중급", 0.2], ["촬영", "초급", 0.25], ["편집", "초급", 0.3], ["모션·디자인", "초급", 0.15]],
  },
  편집: {
    label: "영상 편집(기존 촬영본, 자막·비식별 포함)", mm: 0.1, direct: 50000, facility: 30000,
    roles: [["PM", "중급", 0.1], ["편집", "초급", 0.75], ["자막·검수", "초급", 0.15]],
  },
  쇼츠: {
    label: "숏폼(1분 내외)", mm: 0.15, direct: 200000, facility: 150000,
    roles: [["기획", "중급", 0.2], ["촬영", "초급", 0.3], ["편집", "초급", 0.5]],
  },
};

export const COST = {
  rate: { 중급: LABOR.중급, 초급: LABOR.초급 },
  days: LABOR.days,
  teamMax: 8,          // 내부 + 추가 인력 합쳐 동시에 투입 가능한 최대 인원
  internalPeople: 4,   // 후미디어 내부 제작 인력 수
  internalMonthly: 2156880, // 내부 인력 월 인건비 = 2026년 최저임금 월 환산액(시급 10,320원 × 209시간)
  ownFacility: true,   // 자체 스튜디오·장비 보유 → 장비·스튜디오 경비 제외
  burden: 0.09,        // 법정부담금(4대보험 사업주분 등) — 노임단가에 없는 부분
  overhead: 0.15,      // 제경비(사무실·장비·관리 인력 등 간접비) = 직접인건비 × 비율
  rework: 0.10,        // 수정·검수 대응 추가 투입 = 제작 M/M × 비율
  contingency: 0.10,   // 예비비(일정 지연·추가 요구 등) = 원가 소계 × 비율
  fixedMonthly: 300000, // 월 고정 경비(회의·출장·소모품·클라우드 등)
  pmPerMonth: 0.4,     // PM 최소 투입(기간 내내 관리) M/M/월
  proposalMM: 0.5,     // 제안서·발표·계약 대응 M/M (중급)
  defaultMonths: 3,
};
// 예전 화면 호환용: 중·초급 평균 월 인건비
COST.monthlyLabor = Math.round(((COST.rate.중급 + COST.rate.초급) / 2) * COST.days);

const won = (n) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
const DAY = 864e5;
const r1 = (x) => Math.round(x * 100) / 100;

/** 회사 설정값을 기본값에 덮어씀 */
export function costModel(custom) {
  const c = custom || {};
  const n = (v, d) => (v !== undefined && v !== "" && !isNaN(Number(v)) ? Number(v) : d);
  const units = {};
  for (const [k, u] of Object.entries(UNIT)) {
    units[k] = { ...u, mm: n(c[`mm_${k}`], u.mm), direct: n(c[`direct_${k}`], u.direct) };
  }
  return {
    rate: { 중급: n(c.rateMid, COST.rate.중급), 초급: n(c.rateLow, COST.rate.초급) },
    days: n(c.days, COST.days),
    teamMax: n(c.teamMax, COST.teamMax),
    internalPeople: n(c.internalPeople, COST.internalPeople),
    internalMonthly: n(c.internalMonthly, COST.internalMonthly),
    ownFacility: c.ownFacility === undefined ? COST.ownFacility : !!Number(c.ownFacility),
    burden: n(c.burden, COST.burden),
    overhead: n(c.overhead, COST.overhead),
    rework: n(c.rework, COST.rework),
    contingency: n(c.contingency, COST.contingency),
    fixedMonthly: n(c.fixedMonthly, COST.fixedMonthly),
    pmPerMonth: n(c.pmPerMonth, COST.pmPerMonth),
    proposalMM: n(c.proposalMM, COST.proposalMM),
    units,
    defaultMonths: COST.defaultMonths,
    custom: !!(custom && Object.keys(custom).length),
  };
}

function months(period) {
  const p = String(period || "");
  const m = p.match(/(\d{1,2})\s*개월/);
  const end = p.match(/(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  const d = p.match(/(\d{1,3})\s*일\s*(?:간|이내|까지)?/);
  if (m) return Number(m[1]);
  if (end) {
    const e = new Date(`${end[1]}-${end[2].padStart(2, "0")}-${end[3].padStart(2, "0")}T00:00:00+09:00`);
    const mo = (e - Date.now()) / (30 * DAY);
    if (mo > 0.3) return Math.round(mo * 10) / 10;
  }
  if (d) return Math.max(0.5, Number(d[1]) / 30);
  return null;
}

/** 산출물 수량: 차시 / 영상 제작 / 영상 편집 / 숏폼 → [{kind, n, minutes}] */
export function unitsOf(a) {
  const text = [a.scope || "", ...(a.deliverables || []), ...(a.tasks || [])].join(" \n ");
  const out = [];
  const chasi = Math.max(0, ...[...text.matchAll(/(\d{1,4})\s*차시/g)].map((x) => Number(x[1])));
  if (chasi >= 2) out.push({ kind: "차시", n: chasi });

  // 편당 분량 (예: "10~15분 이내/편당", "3분 내외")
  const mins = [...text.matchAll(/(\d{1,2})\s*(?:~\s*(\d{1,2}))?\s*분\s*(?:내외|이내|이상)?\s*(?:\/\s*편|편당|\/편)?/g)]
    .filter((x) => !/차시/.test(text.slice(x.index - 10, x.index + 20)))
    .map((x) => (x[2] ? (Number(x[1]) + Number(x[2])) / 2 : Number(x[1])));
  const minutes = mins.length ? Math.max(...mins) : null;

  let normal = 0, edit = 0, shorts = 0;
  for (const m of text.matchAll(/(\d{1,3})\s*(편|종)/g)) {
    const around = text.slice(Math.max(0, m.index - 25), m.index + 10);
    if (!/(영상|동영상|편)/.test(around) && m[2] !== "편") continue;
    const n = Number(m[1]);
    if (/(숏폼|쇼츠|숏츠|릴스|\d+\s*초)/.test(around)) shorts = Math.max(shorts, n);
    else if (/편집/.test(around) && !/(촬영|제작)/.test(around)) edit = Math.max(edit, n);
    else if (m[2] === "편") normal = Math.max(normal, n);
  }
  if (edit) out.push({ kind: "편집", n: edit, minutes });
  if (normal && normal !== edit) out.push({ kind: "편", n: normal, minutes });
  if (shorts) out.push({ kind: "쇼츠", n: shorts });
  return out.length ? out : null;
}

function staffCount(a) {
  const t = (a.staff || []).map((x) => (typeof x === "string" ? x : `${x.role} ${x.detail || ""}`)).join(" ");
  const nums = [...t.matchAll(/(\d{1,2})\s*명/g)].map((x) => Number(x[1]));
  return nums.length ? nums.reduce((s, x) => s + x, 0) : null;
}

/**
 * M/M 기반 원가 추정. 근거 우선순위:
 *  1) 발주처 산출내역서의 등급별 M/M (신뢰도 높음)
 *  2) 문서의 산출물 수량 × 단위당 M/M (보통)
 *  3) 문서의 투입 인력 × 기간 (보통)
 *  4) 공고명 기준 가정 (낮음)
 * → rows: 역할별 [역할, 등급, M/M, 인건비]
 */
export function estimateCost(bid, a, custom) {
  if (!a) return null;
  const M = costModel(custom);
  const mo = months(a.period) || M.defaultMonths;
  const monthly = (g) => M.rate[g] * M.days;
  const rows = new Map(); // "역할|등급" → mm
  const addRole = (role, grade, mm) => { const k = `${role}|${grade}`; rows.set(k, (rows.get(k) || 0) + mm); };
  let direct = 0, basis, confidence, assumed = false;

  const sheet = a.costSheet && a.costSheet.found && a.costSheet.mm >= 1 ? a.costSheet : null;
  const us = unitsOf(a);
  const sc = staffCount(a);

  if (sheet) {
    // 발주처 등급(특급·고급 포함)을 우리 중하급 인력으로 대체 투입한다고 보고 계산
    for (const [g, mm] of Object.entries(sheet.grades || {})) addRole(`발주처 ${g}`, /초급/.test(g) ? "초급" : "중급", mm);
    direct = sheet.direct || 0;
    basis = `발주처 산출내역 ${sheet.mm}M/M`;
    confidence = "높음";
  } else if (us) {
    const parts = [];
    for (const { kind, n, minutes } of us) {
      const u = M.units[kind];
      // 영상은 편당 분량에 따라 조정 (제작 5분, 편집 12분 기준)
      const scale = kind === "편" && minutes ? Math.min(3, Math.max(0.5, minutes / 5))
        : kind === "편집" && minutes ? Math.min(2, Math.max(0.5, minutes / 12)) : 1;
      const mmUnit = u.mm * scale;
      for (const [role, grade, share] of u.roles) addRole(role, grade, n * mmUnit * share);
      direct += n * (u.direct - (M.ownFacility ? u.facility || 0 : 0));
      parts.push(`${u.label} ${n}개 × ${r1(mmUnit)}M/M${minutes && kind !== "차시" ? `(편당 ${minutes}분)` : ""}`);
    }
    basis = parts.join(" + ");
    confidence = "보통";
  } else if (sc) {
    const total = sc * mo * 0.6;
    addRole("PM·기획", "중급", total * 0.3);
    addRole("제작 실무", "초급", total * 0.7);
    direct = total * 300000;
    basis = `문서상 투입인력 ${sc}명 × ${mo}개월 × 투입률 60%`;
    confidence = "보통";
  } else {
    const t = String(bid.title || "").replace(/\s+/g, "");
    const g = /(이러닝|차시|원격|교육콘텐츠)/.test(t) ? ["차시", 10] : /(숏폼|쇼츠|릴스)/.test(t) ? ["쇼츠", 3] : ["편", 1];
    const u = M.units[g[0]];
    for (const [role, grade, share] of u.roles) addRole(role, grade, g[1] * u.mm * share);
    direct = g[1] * (u.direct - (M.ownFacility ? u.facility || 0 : 0));
    basis = `수량 미기재로 ${u.label} ${g[1]}개 가정`;
    assumed = true;
    confidence = "낮음";
  }

  // 넉넉하게: 수정·검수 대응, 기간 내 PM 관리, 제안·계약 대응까지 M/M에 포함
  const prodMM = [...rows.values()].reduce((x, y) => x + y, 0);
  if (!sheet) addRole("수정·검수 대응", "초급", prodMM * M.rework);
  const pmNow = [...rows.entries()].filter(([k]) => /^PM\|/.test(k)).reduce((x, [, v]) => x + v, 0);
  const pmNeed = mo * M.pmPerMonth;
  if (pmNow < pmNeed) addRole("PM", "중급", pmNeed - pmNow);
  addRole("제안·계약 대응", "중급", M.proposalMM);

  const totalMM = [...rows.values()].reduce((x, y) => x + y, 0);
  const capMM = M.internalPeople * mo;                 // 기간 동안 내부 인력이 맡을 수 있는 M/M
  const inShare = totalMM ? Math.min(1, capMM / totalMM) : 0;
  const table = [...rows.entries()].map(([k, v]) => {
    const [role, grade] = k.split("|");
    const inMM = v * inShare, exMM = v - inMM;
    return { role, grade, mm: r1(v), inMM, exMM, cost: inMM * M.internalMonthly + exMM * monthly(grade), exCost: exMM * monthly(grade) };
  });
  const mm = table.reduce((t, x) => t + x.mm, 0);
  const inMM = table.reduce((t, x) => t + x.inMM, 0), exMM = table.reduce((t, x) => t + x.exMM, 0);
  const mmMid = table.filter((x) => x.grade === "중급").reduce((t, x) => t + x.mm, 0);

  // 원가계산서: 직접인건비 → 법정부담금 → 직접경비(산출물 + 월 고정) → 제경비 → 예비비
  const build = (f) => {
    const labor = table.reduce((t, x) => t + x.cost, 0) * f;
    const exLabor = table.reduce((t, x) => t + x.exCost, 0) * f;
    const burden = labor * M.burden;
    const dir = direct * f + M.fixedMonthly * mo;
    const ovh = exLabor * M.overhead;
    const sub = labor + burden + dir + ovh;
    const cont = sub * M.contingency;
    return { labor, burden, direct: dir, overhead: ovh, contingency: cont, total: sub + cont };
  };
  const mid = build(1);
  // 원가는 위로 더 크게 빗나가므로 범위를 위쪽으로 넓게
  const spread = confidence === "높음" ? [0.95, 1.2] : confidence === "보통" ? [0.9, 1.35] : [0.8, 1.8];
  const lo = build(spread[0]).total, hi = build(spread[1]).total;
  const supply = bid.price || null; // 추정가격(부가세 제외)
  const mg = (t) => (supply ? (supply - t) / supply : null);
  const people = mm / mo;
  const notes = [];
  if (people > M.teamMax) notes.push(`기간 안에 끝내려면 월 평균 ${people.toFixed(1)}명이 필요해 회사 가용 인력(${M.teamMax}명)을 넘습니다.`);
  if (sheet && sheet.labor) notes.push(`발주처 산정 인건비 ${won(sheet.labor)} 대비 우리(중·초급) 직접인건비 ${won(mid.labor)}`);
  if (supply) {
    // 추가 투입 1M/M당 비용(내부 인력이 다 찬 뒤엔 외부 노임단가)
    const perMM = ((M.rate.중급 + M.rate.초급) / 2) * M.days * (1 + M.burden + M.overhead) * (1 + M.contingency);
    const fixed = (direct + M.fixedMonthly * mo) * (1 + M.contingency);
    const inCost = Math.min(mm, capMM) * M.internalMonthly * (1 + M.burden) * (1 + M.contingency);
    const room = supply - fixed - inCost;
    notes.push(room > 0 ? `손익분기: 내부 ${r1(Math.min(mm, capMM))}M/M에 추가 인력 약 ${r1(room / perMM)}M/M까지 (현재 추가 ${r1(exMM)}M/M)` : `내부 인력만으로도 추정가격을 넘습니다.`);
  }
  const labor = mid.labor;
  return {
    mm: r1(mm), mmMid: r1(mmMid), mmLow: r1(mm - mmMid),
    inMM: r1(inMM), exMM: r1(exMM), inLabor: inMM * M.internalMonthly, exLabor: table.reduce((t, x) => t + x.exCost, 0),
    people: Math.round(people * 10) / 10,
    months: mo,
    table,
    cost: mid,
    range: { lo, hi, marginLo: mg(hi), marginHi: mg(lo) },
    supply, margin: mg(mid.total),
    basis, assumed, confidence, model: M, notes,
    fmt: {
      labor: won(mid.labor), burden: won(mid.burden), direct: won(mid.direct), overhead: won(mid.overhead),
      contingency: won(mid.contingency), total: won(mid.total),
      supply: supply ? won(supply) : "미공개", lo: won(lo), hi: won(hi),
    },
    won,
  };
}

/** 비용·마진·인력·기간: 리스크 표의 핵심 4행 (항상 표시) */
export function costRisks(est) {
  if (!est) return [];
  const out = [];
  const pct = est.margin === null ? null : Math.round(est.margin * 100);
  if (pct === null) out.push({ level: "주의", item: "마진 판단 불가 (추정가격 미공개)", detail: `예상 원가 약 ${est.fmt.total}`, core: true });
  else if (pct < 0 && est.confidence === "낮음") out.push({ level: "주의", item: `적자 가능성 (마진 ${pct}%, 신뢰도 낮음)`, detail: "수량 정보가 없어 가정으로 계산 — 원문 수량 확인 필요", core: true });
  else if (pct < 0) out.push({ level: "높음", item: `적자 예상 (마진 ${pct}%)`, detail: `원가 약 ${est.fmt.total} > 추정가격 ${est.fmt.supply}`, core: true });
  else if (pct < 10) out.push({ level: "주의", item: `마진 낮음 (약 ${pct}%)`, detail: `원가 약 ${est.fmt.total} / 추정가격 ${est.fmt.supply}`, core: true });
  else out.push({ level: "참고", item: `마진 ${pct < 20 ? "보통" : "양호"} (약 ${pct}%)`, detail: `원가 약 ${est.fmt.total} / 추정가격 ${est.fmt.supply}`, core: true });
  out.push({ level: "참고", item: `총 ${est.mm}M/M (중급 ${est.mmMid} · 초급 ${est.mmLow})`, detail: `직접인건비 ${est.fmt.labor} + 부담금 ${est.fmt.burden} + 경비 ${est.fmt.direct} + 제경비 ${est.fmt.overhead} + 예비비 ${est.fmt.contingency}`, core: true });
  if (est.people > est.model.teamMax) out.push({ level: "높음", item: `인력 과부하 (월 ${est.people}명 필요)`, detail: est.notes[0], core: true });
  else if (est.people > est.model.teamMax * 0.7) out.push({ level: "주의", item: `인력 부담 큼 (월 ${est.people}명)`, detail: `${est.months}개월 동안 ${est.mm}M/M`, core: true });
  else out.push({ level: "참고", item: `인력 감당 가능 (월 ${est.people}명)`, detail: `${est.months}개월 동안 ${est.mm}M/M`, core: true });
  if (est.months < 1) out.push({ level: "높음", item: `수행 기간 매우 짧음 (약 ${Math.round(est.months * 30)}일)`, detail: "작업량 대비 기간이 촉박합니다.", core: true });
  else if (est.months < 2 && est.mm > 3) out.push({ level: "주의", item: `수행 기간 빠듯함 (약 ${est.months}개월)`, detail: `총 ${est.mm}M/M을 ${est.months}개월 안에`, core: true });
  else out.push({ level: "참고", item: `수행 기간 약 ${est.months}개월`, detail: `총 ${est.mm}M/M`, core: true });
  return out;
}
