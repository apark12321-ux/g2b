import { ITEMS } from "./cost-items";
// M/M(사람×월) 기반 원가·마진 추정
// 인건비 = 역할별 M/M × 등급별 노임단가(1일) × 월 근무일수. 기준값은 사이트의 '원가 기준 수정'에서 바꿀 수 있음.

// 엔지니어링기술자 노임단가 (한국엔지니어링협회, 2025년 적용, '기타' 부문, 1인 1일)
// 적정 최대치: 엔지니어링 부문 중 단가가 높은 '정보통신' 부문 사용
export const LABOR = { 고급: 301470, 중급: 272298, 초급: 234973, days: 20.5, source: "엔지니어링 노임단가(2025년 적용·정보통신 부문)" };

// 산출물 1단위당 투입 M/M 과 역할 배분 (중급/초급)
export const UNIT = {
  차시: {
    label: "이러닝 차시(25분 내외)", mm: 0.25, direct: 200000, facility: 150000,
    roles: [["PM", "고급", 0.1], ["교수설계·원고", "고급", 0.3], ["촬영", "중급", 0.15], ["편집", "중급", 0.2], ["디자인·모션", "중급", 0.15], ["개발·검수", "초급", 0.1]],
  },
  강의: {
    label: "강의 촬영형 차시(K-MOOC 등, 25분)", mm: 0.15, direct: 50000, facility: 30000,
    roles: [["PM", "고급", 0.1], ["교수설계·원고", "고급", 0.15], ["촬영", "중급", 0.2], ["편집", "중급", 0.35], ["디자인·모션", "중급", 0.1], ["자막·검수", "초급", 0.1]],
  },
  편: {
    label: "영상 제작(기획·촬영·편집, 5분 기준)", mm: 0.8, direct: 2000000, facility: 1200000,
    roles: [["PM", "고급", 0.1], ["기획·작가", "중급", 0.2], ["촬영", "중급", 0.25], ["편집", "중급", 0.3], ["모션·디자인", "중급", 0.15]],
  },
  편집: {
    label: "영상 편집(기존 촬영본, 자막·비식별 포함)", mm: 0.1, direct: 50000, facility: 30000,
    roles: [["PM", "고급", 0.1], ["편집", "중급", 0.75], ["자막·검수", "초급", 0.15]],
  },
  쇼츠: {
    label: "숏폼(1분 내외)", mm: 0.15, direct: 200000, facility: 150000,
    roles: [["기획", "중급", 0.2], ["촬영", "중급", 0.3], ["편집", "중급", 0.5]],
  },
};

export const COST = {
  rate: { 고급: LABOR.고급, 중급: LABOR.중급, 초급: LABOR.초급 },
  days: LABOR.days,
  teamMax: 8,          // 내부 + 추가 인력 합쳐 동시에 투입 가능한 최대 인원
  internalPeople: 4,   // 후미디어 내부 제작 인력 수
  internalMonthly: 0,  // 내부 제작 인력 월 인건비를 따로 정할 때만 (0 = 노임단가 적정 최대치 적용)
  ownFacility: true,   // 자체 스튜디오·장비 보유 → 장비·스튜디오 경비 제외
  burden: 0.09,        // 법정부담금(4대보험 사업주분 등) — 노임단가에 없는 부분
  targetMargin: 0.15,  // 목표 마진: 역마진 없이 '예산 안에서' 인력을 배치하는 기준
  overhead: 0.05,      // 제경비: 원가에 넣지 않고 마진 안에서 떼어 둘 몫 = 직접인건비 × 비율
  rework: 0.10,        // 수정·검수 대응 추가 투입 = 제작 M/M × 비율
  contingency: 0.05,   // 예비비: 원가에 넣지 않고 마진 안에서 떼어 둘 몫 = 직접원가 × 비율
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
    rate: { 고급: n(c.rateHigh, COST.rate.고급), 중급: n(c.rateMid, COST.rate.중급), 초급: n(c.rateLow, COST.rate.초급) },
    days: n(c.days, COST.days),
    teamMax: n(c.teamMax, COST.teamMax),
    internalPeople: n(c.internalPeople, COST.internalPeople),
    internalMonthly: n(c.internalMonthly, COST.internalMonthly),
    ownFacility: c.ownFacility === undefined ? COST.ownFacility : !!Number(c.ownFacility),
    burden: n(c.burden, COST.burden),
    overhead: n(c.overhead, COST.overhead),
    targetMargin: n(c.targetMargin, COST.targetMargin),
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

/** 수행기간(개월): 종료일이 있으면 '시작일(계약 예정일) ~ 종료일' */
function months(period, start) {
  const p = String(period || "");
  const m = p.match(/(\d{1,2})\s*개월/);
  const end = p.match(/(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  const d = p.match(/(\d{1,3})\s*일\s*(?:간|이내|까지)?/);
  if (m) return Number(m[1]);
  if (end) {
    const e = new Date(`${end[1]}-${end[2].padStart(2, "0")}-${end[3].padStart(2, "0")}T00:00:00+09:00`);
    const from = start ? new Date(start).getTime() : Date.now();
    const mo = (e - from) / (30 * DAY);
    if (mo > 0.3) return Math.round(mo * 10) / 10;
  }
  if (d) return Math.max(0.5, Number(d[1]) / 30);
  return null;
}

/** 산출물 수량: 차시 / 영상 제작 / 영상 편집 / 숏폼 → [{kind, n, minutes}] */
const blockSumPre = (text) => /\d{1,2}\s*주차?[^\n]{0,20}?주차?\s*(?:당|별)\s*\d{1,2}\s*(?:개\s*)?차시/.test(text) || /총\s*\d{1,4}\s*개\s*(?:영상|차시)/.test(text);
export function unitsOf(a, title = "") {
  const text = [a.scope || "", ...(a.deliverables || []), ...(a.tasks || []), ...(a.qty || [])].join(" \n ");
  const out = [];
  const max = (re) => Math.max(0, ...[...text.matchAll(re)].map((x) => Number(x[1])));
  // 강좌형(K-MOOC 등): 강좌 수 × 주차 × 주차당 차시
  const courses = max(/(\d{1,3})\s*(?:개\s*)?(?:강좌|과목|과정|강의)(?!\s*당)/g) || max(/(?:강좌|과목|과정|강의)\s*(\d{1,3})\s*개/g);
  const weeks = max(/(\d{1,2})\s*(?:주차|주\s*(?:분량|과정|이상))/g);
  const perWeek = max(/주차?\s*(?:당|별)\s*(\d{1,2})\s*(?:개\s*)?차시/g);
  const chasiMin = max(/차시\s*(?:\([^)]{0,10}\))?\s*(?:당|별)?\s*(\d{1,2})\s*분/g) || max(/(\d{1,2})\s*분\s*(?:내외|이상|이내)?\s*\/\s*차시/g);
  const weekMin = max(/주차?\s*(?:당|별)\s*(\d{2,3})\s*분/g);
  let chasi = max(/(\d{1,4})\s*(?:개\s*)?차시/g);
  // 강좌별로 적힌 경우: "총 13주차 (주차당 3개 차시)" + "총 15주차 (주차당 3개 차시)" → 합산
  const sum = (re, f) => [...text.matchAll(re)].reduce((t, x) => t + f(x), 0);
  const blockSum = sum(/(\d{1,2})\s*주차?[^\n]{0,20}?주차?\s*(?:당|별)\s*(\d{1,2})\s*(?:개\s*)?차시/g, (x) => Number(x[1]) * Number(x[2]));
  const videoSum = sum(/총\s*(\d{1,4})\s*개\s*(?:영상|차시|강의\s*영상)/g, (x) => Number(x[1]));
  chasi = Math.max(chasi, blockSum, videoSum);
  if (courses && weeks && !blockSumPre(text)) {
    const total = courses * weeks * (perWeek || (weekMin && chasiMin ? Math.max(1, Math.round(weekMin / chasiMin)) : 2));
    chasi = Math.max(chasi, total); // 문서에 적힌 총 차시와 계산값 중 큰 쪽 (보수적)
  }
  const cMin = chasiMin || (weekMin && perWeek ? weekMin / perWeek : null);
  // 교수 강의를 촬영·편집하는 형태(K-MOOC·강의 촬영)는 별도 단위
  const lecture = /MOOC|무크|강의\s*촬영|교수\s*(?:촬영|출연)|강의\s*영상/i.test(`${title} ${text}`);
  if (chasi >= 2) out.push({ kind: lecture ? "강의" : "차시", n: chasi, minutes: cMin, courses: courses || null, weeks: weeks || null });

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
  const nums = [...t.matchAll(/(\d{1,2})\s*(?:명|인)(?!\s*(?:당|건|월))/g)].map((x) => Number(x[1]));
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
  // 시작일: 결과 발표일 + 7일 (계약일). 예전 분석은 입찰마감 + 14일로 추정
  const start = a.contractStart || (bid.close_at ? new Date(new Date(bid.close_at).getTime() + 14 * DAY).toISOString() : null);
  const mo = Number(a.periodMonths) > 0 ? Number(a.periodMonths) : months(a.period, start) || M.defaultMonths;
  const monthly = (g) => M.rate[g] * M.days;
  const rows = new Map(); // "역할|등급" → mm
  const addRole = (role, grade, mm) => { const k = `${role}|${grade}`; rows.set(k, (rows.get(k) || 0) + mm); };
  let direct = 0, basis, confidence, assumed = false, check = null;

  const sheet = a.costSheet && a.costSheet.found && a.costSheet.mm >= 1 ? a.costSheet : null;
  const us = unitsOf(a, bid.title);
  const sc = staffCount(a);

  if (sheet) {
    // 발주처 등급(특급·고급 포함)을 우리 중하급 인력으로 대체 투입한다고 보고 계산
    for (const [g, mm] of Object.entries(sheet.grades || {})) addRole(`발주처 ${g}`, /초급/.test(g) ? "초급" : /중급/.test(g) ? "중급" : "고급", mm);
    direct = sheet.direct || 0;
    basis = `발주처 산출내역 ${sheet.mm}M/M`;
    confidence = "높음";
  } else if (us) {
    const parts = [];
    for (const { kind, n, minutes } of us) {
      const u = M.units[kind];
      // 영상은 편당 분량에 따라 조정 (제작 5분, 편집 12분 기준)
      const scale = kind === "편" && minutes ? Math.min(3, Math.max(0.5, minutes / 5))
        : kind === "편집" && minutes ? Math.min(2, Math.max(0.5, minutes / 12))
        : (kind === "차시" || kind === "강의") && minutes ? Math.min(2, Math.max(0.6, minutes / 25)) : 1;
      const mmUnit = u.mm * scale;
      for (const [role, grade, share] of u.roles) addRole(role, grade, n * mmUnit * share);
      direct += n * (u.direct - (M.ownFacility ? u.facility || 0 : 0));
      parts.push(`${u.label} ${n}개 × ${r1(mmUnit)}M/M${minutes ? `(${kind === "차시" || kind === "강의" ? "차시" : "편"}당 ${minutes}분)` : ""}`);
    }
    // 보수적으로: 산출량 기준 M/M에 15% 여유
    for (const [k, v] of rows) rows.set(k, v * 1.15);
    basis = parts.join(" + ") + " (+여유 15%)";
    // 문서가 요구한 투입인력 × 기간과 비교 — 더 큰 쪽으로 확충
    if (sc) {
      const fromUnits = [...rows.values()].reduce((x, y) => x + y, 0);
      const fromStaff = sc * mo * 0.8; // 요구 인력이 기간 동안 평균 80% 투입
      check = { fromUnits: r1(fromUnits), fromStaff: r1(fromStaff), staff: sc };
      if (fromStaff > fromUnits) {
        const k = fromStaff / fromUnits;
        for (const [key, v] of rows) rows.set(key, v * k);
        basis += ` → 문서 요구 인력 ${sc}명 기준이 더 커서 ${r1(fromStaff)}M/M로 확충`;
      }
    }
    confidence = "보통";
  } else if (sc) {
    const total = sc * mo * 0.6;
    addRole("PM·기획", "고급", total * 0.3);
    addRole("제작 실무", "중급", total * 0.7);
    direct = total * 300000;
    basis = `문서상 투입인력 ${sc}명 × ${mo}개월 × 투입률 60%`;
    confidence = "보통";
  } else {
    const t = String(bid.title || "").replace(/\s+/g, "");
    // K-MOOC: 강좌당 15주 × 주 2차시, 강좌 수는 예산으로 추정(강좌당 약 4천만원)
    const mooc = /MOOC|무크/i.test(t);
    const courses = mooc ? Math.max(1, Math.round((bid.price || 40000000) / 40000000)) : 0;
    const g = mooc ? ["강의", courses * 30] : /(이러닝|차시|원격|교육콘텐츠)/.test(t) ? ["차시", 10] : /(숏폼|쇼츠|릴스)/.test(t) ? ["쇼츠", 3] : ["편", 1];
    const u = M.units[g[0]];
    for (const [role, grade, share] of u.roles) addRole(role, grade, g[1] * u.mm * share);
    direct = g[1] * (u.direct - (M.ownFacility ? u.facility || 0 : 0));
    basis = mooc ? `분량 미확인 — K-MOOC ${courses}강좌 × 15주 × 2차시 = ${g[1]}차시로 가정` : `수량 미기재로 ${u.label} ${g[1]}개 가정`;
    assumed = true;
    confidence = "낮음";
  }

  // 제안요청서에서 찾은 비용 항목: 외부 지출은 직접경비로, 추가 작업은 해당 역할 M/M로
  const ctx = (() => {
    const list = us || [];
    const n = (k) => list.filter((x) => x.kind === k).reduce((t, x) => t + x.n, 0);
    const mins = (k, d) => list.filter((x) => x.kind === k).reduce((t, x) => t + x.n * (x.minutes || d), 0);
    const units = list.reduce((t, x) => t + x.n, 0) || 1;
    const videos = n("편") + n("편집") + n("쇼츠");
    const minutes = mins("차시", 25) + mins("강의", 25) + mins("편", 5) + mins("편집", 12) + mins("쇼츠", 1);
    const narrMinutes = mins("차시", 25) + mins("편", 5) + mins("쇼츠", 1); // 기존 촬영본 편집·교수 강의엔 내레이션 없음
    const shootDays = Math.ceil(n("차시") / 4 + n("강의") / 4 + n("편") + n("쇼츠") / 5) || 1;
    return { units, videos, lectures: n("강의") + n("차시"), minutes, narrMinutes, shootDays, months: mo, meetings: (a.costItems && a.costItems.meetings) || 2, price: bid.price || 0 };
  })();
  const off = new Set(a.costOff || []);
  const items = [];
  for (const f of (a.costItems && a.costItems.items) || []) {
    const def = ITEMS.find((x) => x.key === f.key);
    if (!def) continue;
    const row = { key: f.key, label: def.label, type: def.type, evidence: f.evidence, how: def.how, off: off.has(f.key), amount: 0, mm: 0 };
    if (def.type === "expense") {
      if (M.ownFacility && (f.key === "studio" || f.key === "gear")) { row.how = "자체 시설·장비 보유로 제외"; row.auto = true; }
      else row.amount = Math.round(def.calc(ctx, f.m) || 0);
      if (!row.off) direct += row.amount;
    } else {
      row.mm = Math.round((def.mm(ctx, f.m) || 0) * 100) / 100;
      // 이러닝 차시의 스토리보드는 단위 투입에 이미 포함
      if (f.key === "storyboard" && !ctx.videos) { row.mm = 0; row.how = "이러닝 차시 기본 투입에 포함"; row.auto = true; }
      if (!row.off && row.mm) addRole(def.role[0], def.role[1], row.mm);
    }
    items.push(row);
  }
  const itemsTotal = items.filter((x) => !x.off).reduce((t, x) => t + x.amount, 0);

  // 넉넉하게: 수정·검수 대응, 기간 내 PM 관리, 제안·계약 대응까지 M/M에 포함
  const prodMM = [...rows.values()].reduce((x, y) => x + y, 0);
  // 수정·검수 대응은 같은 제작 인력이 더 일하는 것 → 각 제작 역할 투입을 늘림 (별도 인원 아님)
  if (!sheet) for (const [k, v] of rows) if (!/^PM\|/.test(k)) rows.set(k, v * (1 + M.rework));
  const pmNow = [...rows.entries()].filter(([k]) => /^PM\|/.test(k)).reduce((x, [, v]) => x + v, 0);
  const pmNeed = mo * M.pmPerMonth;
  if (pmNow < pmNeed) addRole("PM", "고급", pmNeed - pmNow);
  addRole("PM", "고급", M.proposalMM); // 제안서·발표·계약 대응은 PM이 맡음

  const totalMM = [...rows.values()].reduce((x, y) => x + y, 0);
  const capMM = M.internalPeople * mo;                 // 기간 동안 내부 인력이 맡을 수 있는 M/M
  const inShare = M.internalMonthly > 0 && totalMM ? Math.min(1, capMM / totalMM) : 0;
  const table = [...rows.entries()].map(([k, v]) => {
    const [role, grade] = k.split("|");
    const inMM = grade === "고급" ? 0 : v * inShare, exMM = v - inMM; // PM·교수설계(고급)는 항상 적정 최대 단가
    // 사람 단위로: 필요한 인원(올림) × 투입률 × 기간
    const heads = Math.max(1, Math.ceil(v / mo - 0.05));
    const rate = Math.min(1, v / (heads * mo));
    return { role, grade, mm: r1(v), heads, rate, inMM, exMM, cost: inMM * M.internalMonthly + exMM * monthly(grade), exCost: exMM * monthly(grade) };
  });
  const mm = table.reduce((t, x) => t + x.mm, 0);
  const heads = table.reduce((t, x) => t + x.heads, 0);
  const avgRate = heads ? Math.min(1, mm / (heads * mo)) : 0;
  const inMM = table.reduce((t, x) => t + x.inMM, 0), exMM = table.reduce((t, x) => t + x.exMM, 0);
  const mmOf = (g) => table.filter((x) => x.grade === g).reduce((t, x) => t + x.mm, 0);
  const mmHigh = mmOf("고급"), mmMid = mmOf("중급");

  // 원가계산서: 직접인건비 → 법정부담금 → 직접경비(산출물 + 월 고정) → 제경비 → 예비비
  const build = (f) => {
    const labor = table.reduce((t, x) => t + x.cost, 0) * f;
    const exLabor = table.reduce((t, x) => t + x.exCost, 0) * f;
    const burden = labor * M.burden;
    const dir = direct * f + M.fixedMonthly * mo;
    // 원가 = 직접원가(인건비 + 법정부담금 + 직접경비). 제경비·예비비는 마진 안의 몫으로만 표시
    const total = labor + burden + dir;
    const ovh = labor * M.overhead;
    const cont = total * M.contingency;
    return { labor, burden, direct: dir, overhead: ovh, contingency: cont, total };
  };
  const need = build(1); // 산출량 기준으로 '필요한' 원가
  const supply = bid.price || null; // 추정가격(부가세 제외)
  const people = mm / mo;
  const notes = [];

  // ── 예산 기준 계획: 역마진 없이 목표 마진을 남기는 선에서 쓸 수 있는 인력(M/M)을 배치
  const fixed = direct + M.fixedMonthly * mo;          // 외부 지출(필수)
  const perMM = (need.labor / (mm || 1)) * (1 + M.burden); // 역할 구성 기준 1M/M당 인건비(부담금 포함)
  let availMM = null, intensity = null, k = 1, budget = null;
  if (supply) {
    budget = supply * (1 - M.targetMargin);
    availMM = Math.max(0, (budget - fixed) / perMM);
    intensity = availMM > 0 ? mm / availMM : 99;
    k = mm ? availMM / mm : 0;
  }
  const plan = table.map((x) => ({
    ...x,
    needMM: x.mm, needRate: x.mm / (x.heads * mo),
    mm: r1(x.mm * k), rate: (x.mm * k) / (x.heads * mo), cost: x.cost * k, exCost: x.exCost * k,
  }));
  const pLabor = need.labor * k;
  const pBurden = pLabor * M.burden;
  const pTotal = supply ? Math.min(budget, pLabor + pBurden + fixed) + Math.max(0, fixed - budget) : need.total;
  const cost = supply
    ? { labor: pLabor, burden: pBurden, direct: fixed, total: pTotal, overhead: pLabor * M.overhead, contingency: pTotal * M.contingency }
    : need;
  const planMM = supply ? availMM : mm;
  const avgRatePlan = heads ? planMM / (heads * mo) : 0;
  const avgRateNeed = heads ? mm / (heads * mo) : 0;
  const units = (us || []).reduce((t, x) => t + x.n, 0);
  const perUnitDays = (v) => (units ? Math.round(((v * M.days) / units) * 10) / 10 : null);

  if (people > M.teamMax) notes.push(`산출량을 다 하려면 전일 기준 ${people.toFixed(1)}명이 필요해 회사 가용 인력(${M.teamMax}명)을 넘습니다.`);
  // 인건비 외 물품·제작물(키트·교구·장비·인쇄 등)
  const allTxt = [bid.title, a.scope, ...(a.deliverables || []), ...(a.tasks || []), ...(a.qty || [])].join(" ");
  const goods = allTxt.match(/(키트|교구|기자재|하드웨어|장비\s*(?:구매|구입|납품|제작)|VR\s*스테이션|굿즈|기념품|\d+\s*(?:세트|대)\b)/);
  if (goods) {
    notes.unshift(`'${goods[1]}' 등 물품·제작비가 있는 사업입니다. 물품 단가만큼 인력에 쓸 예산이 줄어듭니다.`);
    if (confidence !== "낮음") confidence = "낮음";
  }
  if (check) notes.push(`인력 점검: 문서 요구 인력 ${check.staff}명과 산출량 기준 투입을 비교해 ${check.fromStaff > check.fromUnits ? "요구 인력 기준(80% 투입)" : "산출량 기준"}으로 산정`);
  if (sheet && sheet.labor) notes.push(`발주처 산정 인건비 ${won(sheet.labor)} 대비 우리 필요 인건비 ${won(need.labor)}`);
  if (supply && units) notes.push(`예산 내 산출물 1개당 투입 가능 ${perUnitDays(availMM)}일 (산출량 기준 필요 ${perUnitDays(mm)}일)`);

  const margin = supply ? (supply - cost.total) / supply : null;
  const net = supply ? supply - cost.total - cost.overhead - cost.contingency : null;
  return {
    heads, avgRate: avgRateNeed, avgRatePlan, avgRateNeed, intensity, availMM: availMM === null ? null : r1(availMM),
    needMM: r1(mm), mm: r1(planMM), mmHigh: r1(mmHigh), mmMid: r1(mmMid), mmLow: r1(mm - mmHigh - mmMid),
    inMM: r1(inMM), exMM: r1(exMM), inLabor: inMM * M.internalMonthly, exLabor: table.reduce((t, x) => t + x.exCost, 0),
    people: Math.round(people * 10) / 10,
    months: mo,
    monthsSource: Number(a.periodMonths) > 0 ? "직접 입력" : months(a.period, start) ? "문서" : "기본값",
    start, startBasis: a.startBasis || "입찰마감 + 14일(추정)",
    endText: (String(a.period || "").match(/(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/) || [])[0] || "",
    table: plan,
    cost, need,
    range: { lo: need.total, hi: need.total, marginLo: margin, marginHi: margin },
    supply, margin, net, perUnitDays: { plan: supply ? perUnitDays(availMM) : null, need: perUnitDays(mm) },
    basis, assumed, confidence, model: M, notes, check, items, itemsTotal, goods: goods ? goods[1] : null,
    fmt: {
      labor: won(cost.labor), burden: won(cost.burden), direct: won(cost.direct), overhead: won(cost.overhead),
      contingency: won(cost.contingency), total: won(cost.total), needTotal: won(need.total),
      margin: supply ? won(supply - cost.total) : "-", net: supply ? won(net) : "-",
      supply: supply ? won(supply) : "미공개", lo: won(need.total), hi: won(need.total),
    },
    won,
  };
}

/** 비용·마진·인력·기간: 리스크 표의 핵심 4행 (항상 표시) */
export function costRisks(est) {
  if (!est) return [];
  const out = [];
  if (est.goods) out.push({ level: "주의", item: `물품·제작비 확인 ('${est.goods}')`, detail: "물품 단가만큼 인력 예산이 줄어듦 — 수량·단가 확인", core: true });
  const pd = est.perUnitDays || {};
  if (est.intensity === null) {
    out.push({ level: "주의", item: "추정가격 미공개 — 예산 기준 계획 불가", detail: `산출량 기준 필요 직접원가 약 ${est.fmt.needTotal}`, core: true });
  } else {
    const r = est.intensity, pct = Math.round(r * 100);
    const d = pd.plan && pd.need ? ` · 산출물당 ${pd.plan}일로 해야 함 (필요 ${pd.need}일)` : "";
    if (r <= 1) out.push({ level: "참고", item: `예산 안에서 수행 가능 (작업량 ${pct}%)`, detail: `필요 ${est.needMM}M/M ≤ 예산 내 ${est.availMM}M/M${d}`, core: true });
    else if (r <= 1.25) out.push({ level: "주의", item: `작업 강도 높음 (예산 대비 작업량 ${pct}%)`, detail: `필요 ${est.needMM}M/M > 예산 내 ${est.availMM}M/M${d}`, core: true });
    else if (r <= 1.6) out.push({ level: "높음", item: `예산 대비 작업량 과다 (${pct}%)`, detail: `필요 ${est.needMM}M/M vs 예산 내 ${est.availMM}M/M${d}`, core: true });
    else out.push({ level: "높음", item: `예산으로 소화 어려움 (작업량 ${pct}%)`, detail: `필요 ${est.needMM}M/M vs 예산 내 ${est.availMM}M/M${d}`, core: true });
  }
  if (est.supply) out.push({ level: "참고", item: `목표 마진 ${Math.round(est.model.targetMargin * 100)}% 기준 계획`, detail: `직접원가 ${est.fmt.total} · 마진 ${est.fmt.margin} (제경비·예비비 몫 포함, 순이익 ${est.fmt.net})`, core: true });
  if (est.people > est.model.teamMax) out.push({ level: "높음", item: `인력 과부하 (전일 기준 ${est.people}명 필요)`, detail: est.notes.find((x) => /가용 인력/.test(x)) || "", core: true });
  else if (est.people > est.model.teamMax * 0.7) out.push({ level: "주의", item: `인력 부담 큼 (전일 기준 ${est.people}명)`, detail: `${est.heads}명 × ${est.months}개월`, core: true });
  if (est.months < 1) out.push({ level: "높음", item: `수행 기간 매우 짧음 (약 ${Math.round(est.months * 30)}일)`, detail: "작업량 대비 기간이 촉박합니다.", core: true });
  else if (est.months < 2 && est.needMM > 3) out.push({ level: "주의", item: `수행 기간 빠듯함 (약 ${est.months}개월)`, detail: `${est.heads}명이 ${est.months}개월 안에`, core: true });
  else out.push({ level: "참고", item: `수행 기간 약 ${est.months}개월`, detail: `${est.heads}명 투입`, core: true });
  return out;
}
