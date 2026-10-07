// 원가·마진 추정 (규칙 기반). 아래 기준값은 회사 실제 단가에 맞춰 조정하세요.
// 엔지니어링기술자 노임단가 (한국엔지니어링협회, 2025년 적용, '기타' 부문, 1인 1일)
export const LABOR = { 중급: 246345, 초급: 219507, days: 20.5, source: "엔지니어링 노임단가(2025년 적용·기타 부문) 중급·초급 평균" };
const MONTHLY = Math.round(((LABOR.중급 + LABOR.초급) / 2) * LABOR.days);

export const COST = {
  monthlyLabor: MONTHLY,   // 1인 월 인건비 = 중·초급 기술자 일 노임 평균 × 월 근무일수
  teamMax: 6,              // 동시에 투입 가능한 최대 인원
  overhead: 0.10,          // 간접비(일반관리비) 비율
  // 산출물 1단위당 필요 인력(MM: 사람×월)과 직접경비
  units: {
    차시: { mm: 0.28, direct: 200000, label: "이러닝 차시" },
    편: { mm: 0.8, direct: 1500000, label: "영상 편" },
    쇼츠: { mm: 0.15, direct: 200000, label: "숏폼" },
  },
  defaultMonths: 3,
};

const won = (n) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
const DAY = 864e5;

function months(period) {
  const p = String(period || "");
  const d = p.match(/(\d{1,3})\s*일\s*(?:간|이내|까지)?/);
  const m = p.match(/(\d{1,2})\s*개월/);
  const end = p.match(/(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  if (m) return Number(m[1]);
  if (d && !end) return Math.max(0.5, Number(d[1]) / 30);
  if (end) {
    const e = new Date(`${end[1]}-${end[2].padStart(2, "0")}-${end[3].padStart(2, "0")}T00:00:00+09:00`);
    const mo = (e - Date.now()) / (30 * DAY);
    if (mo > 0.3) return Math.round(mo * 10) / 10;
  }
  return null;
}

/** 산출물 수량: 이러닝 차시, 일반 영상 편, 숏폼 편을 나눠 셈 → [{kind, n}] */
function units(a) {
  const text = [...(a.deliverables || []), ...(a.tasks || [])].join(" \n ");
  const chasi = Math.max(0, ...[...text.matchAll(/(\d{1,4})\s*차시/g)].map((x) => Number(x[1])));
  if (chasi >= 2) return [{ kind: "차시", n: chasi }];
  let normal = 0, shorts = 0;
  const seen = new Set();
  for (const m of text.matchAll(/(\d{1,3})\s*편/g)) {
    const before = text.slice(Math.max(0, m.index - 18), m.index);
    const key = `${m.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = Number(m[1]);
    if (/(숏폼|쇼츠|숏츠|릴스|\d+\s*초)/.test(before)) shorts = Math.max(shorts, n);
    else normal = Math.max(normal, n);
  }
  const out = [];
  if (normal) out.push({ kind: "편", n: normal });
  if (shorts) out.push({ kind: "쇼츠", n: shorts });
  return out.length ? out : null;
}

/** 공고 문서에 적힌 인원 수 합계 (예: "PM 1명, 교수설계자 2명") */
function staffCount(a) {
  const t = (a.staff || []).map((x) => (typeof x === "string" ? x : `${x.role} ${x.detail || ""}`)).join(" ");
  const nums = [...t.matchAll(/(\d{1,2})\s*명/g)].map((x) => Number(x[1]));
  return nums.length ? nums.reduce((s, x) => s + x, 0) : (a.staff || []).length || null;
}

/**
 * → { mm, people, months, cost: {labor, direct, overhead, total}, supply, margin, basis, notes }
 *   margin: (공급가액 - 원가) / 공급가액  (공급가액 = 추정가격, 없으면 예산/1.1)
 */
/** 회사 설정값(사이트에서 수정)을 기본값에 덮어씀 */
export function costModel(custom) {
  const c = custom || {};
  return {
    monthlyLabor: Number(c.monthlyLabor) || COST.monthlyLabor,
    teamMax: Number(c.teamMax) || COST.teamMax,
    overhead: c.overhead !== undefined && c.overhead !== "" ? Number(c.overhead) : COST.overhead,
    units: {
      차시: { ...COST.units.차시, ...(c.chasiMM ? { mm: Number(c.chasiMM) } : {}), ...(c.chasiDirect ? { direct: Number(c.chasiDirect) } : {}) },
      편: { ...COST.units.편, ...(c.videoMM ? { mm: Number(c.videoMM) } : {}), ...(c.videoDirect ? { direct: Number(c.videoDirect) } : {}) },
      쇼츠: { ...COST.units.쇼츠, ...(c.shortsMM ? { mm: Number(c.shortsMM) } : {}), ...(c.shortsDirect ? { direct: Number(c.shortsDirect) } : {}) },
    },
    defaultMonths: COST.defaultMonths,
    custom: !!(custom && Object.keys(custom).length),
  };
}

/**
 * 원가 추정. 근거 우선순위:
 *  1) 발주처 산출내역서의 투입 MM (신뢰도 높음)
 *  2) 문서의 납품 수량 × 단위당 투입 (보통)
 *  3) 문서의 투입 인력 × 기간 (보통)
 *  4) 공고명 기준 가정 (낮음)
 * 결과는 예상치와 함께 범위(낮게~높게)를 줌
 */
export function estimateCost(bid, a, custom) {
  if (!a) return null;
  const M = costModel(custom);
  const mo = months(a.period) || M.defaultMonths;
  const u = units(a);
  const sc = staffCount(a);
  const sheet = a.costSheet && a.costSheet.found ? a.costSheet : null;
  let mm, direct, basis, assumed = false, confidence;

  if (sheet && sheet.mm >= 1) {
    mm = sheet.mm;
    direct = sheet.direct || 0;
    const g = Object.entries(sheet.grades || {}).map(([k, v]) => `${k} ${Math.round(v * 10) / 10}MM`).join(", ");
    basis = `발주처 산출내역 투입인력 ${sheet.mm}MM${g ? ` (${g})` : ""}${sheet.direct ? `, 직접경비 ${won(sheet.direct)}` : ""}`;
    confidence = "높음";
  } else if (u) {
    mm = 0; direct = 0;
    basis = u.map(({ kind, n }) => {
      const k = M.units[kind];
      mm += n * k.mm;
      direct += n * k.direct;
      return `${k.label} ${n}개(단위당 ${k.mm}MM·경비 ${won(k.direct)})`;
    }).join(" + ") + " 기준";
    if (sc) mm = Math.max(mm, sc * mo * 0.3); // 문서가 요구하는 최소 인력보다 적게 잡지 않음
    confidence = "보통";
  } else if (sc) {
    mm = sc * mo * 0.6;
    direct = mm * 300000;
    basis = `문서상 투입인력 ${sc}명 × ${mo}개월 × 투입률 60% 기준`;
    confidence = "보통";
  } else {
    const t = String(bid.title || "").replace(/\s+/g, "");
    const guess = /(이러닝|차시|원격|교육콘텐츠)/.test(t) ? { kind: "차시", n: 10 }
      : /(숏폼|쇼츠|릴스)/.test(t) ? { kind: "쇼츠", n: 3 }
      : { kind: "편", n: 1 };
    const k = M.units[guess.kind];
    mm = guess.n * k.mm;
    direct = guess.n * k.direct;
    basis = `수량 미기재로 ${k.label} ${guess.n}개 가정`;
    assumed = true;
    confidence = "낮음";
  }

  const calc = (m) => {
    const labor = m * M.monthlyLabor;
    const sub = labor + direct;
    const overhead = sub * M.overhead;
    return { labor, overhead, total: sub + overhead };
  };
  const mid = calc(mm);
  const spread = confidence === "높음" ? [0.9, 1.1] : confidence === "보통" ? [0.8, 1.3] : [0.6, 1.8];
  const lo = calc(mm * spread[0]).total, hi = calc(mm * spread[1]).total;
  const supply = bid.price || null; // 나라장터 추정가격(부가세 제외)
  const mg = (t) => (supply ? (supply - t) / supply : null);
  const people = mm / mo;
  const notes = [];
  if (people > M.teamMax) notes.push(`기간 안에 끝내려면 월 평균 ${people.toFixed(1)}명이 필요해 회사 가용 인력(${M.teamMax}명)을 넘습니다.`);
  if (sheet && sheet.labor) notes.push(`발주처 산정 인건비 ${won(sheet.labor)} 대비 우리 예상 인건비 ${won(mid.labor)}`);

  return {
    mm: Math.round(mm * 10) / 10,
    people: Math.round(people * 10) / 10,
    months: mo,
    cost: { labor: mid.labor, direct, overhead: mid.overhead, total: mid.total },
    range: { lo, hi, marginLo: mg(hi), marginHi: mg(lo) },
    supply,
    margin: mg(mid.total),
    basis,
    assumed,
    confidence,
    model: M,
    notes,
    fmt: {
      labor: won(mid.labor), direct: won(direct), overhead: won(mid.overhead), total: won(mid.total),
      supply: supply ? won(supply) : "미공개", lo: won(lo), hi: won(hi),
    },
  };
}

/** 비용·마진·인력·기간: 리스크 표의 핵심 4행 (항상 표시) */
export function costRisks(est) {
  if (!est) return [];
  if (est.unknown) {
    return [{ level: "주의", item: "원가·마진 추정 불가", detail: "문서에서 납품 수량·투입 인력을 찾지 못했습니다. 첨부를 직접 확인하세요.", core: true }];
  }
  const out = [];
  const pct = est.margin === null ? null : Math.round(est.margin * 100);
  // 마진
  if (pct === null) out.push({ level: "주의", item: "마진 판단 불가 (추정가격 미공개)", detail: `예상 원가 약 ${est.fmt.total}`, core: true });
  else if (pct < 0 && est.confidence === "낮음") out.push({ level: "주의", item: `적자 가능성 (마진 ${pct}%, 신뢰도 낮음)`, detail: `수량 정보가 없어 가정으로 계산 — 원문 수량 확인 필요`, core: true });
  else if (pct < 0) out.push({ level: "높음", item: `적자 예상 (마진 ${pct}%)`, detail: `원가 약 ${est.fmt.total} > 추정가격 ${est.fmt.supply}`, core: true });
  else if (pct < 10) out.push({ level: "주의", item: `마진 낮음 (약 ${pct}%)`, detail: `원가 약 ${est.fmt.total} / 추정가격 ${est.fmt.supply}`, core: true });
  else out.push({ level: "참고", item: `마진 ${pct < 20 ? "보통" : "양호"} (약 ${pct}%)`, detail: `원가 약 ${est.fmt.total} / 추정가격 ${est.fmt.supply}`, core: true });
  // 비용 구성
  out.push({ level: "참고", item: `예상 원가 약 ${est.fmt.total}`, detail: `인건비 ${est.fmt.labor} + 경비 ${est.fmt.direct} + 간접비 ${est.fmt.overhead}`, core: true });
  // 인력
  if (est.people > est.model.teamMax) out.push({ level: "높음", item: `인력 과부하 (월 ${est.people}명 필요)`, detail: est.notes[0], core: true });
  else if (est.people > est.model.teamMax * 0.7) out.push({ level: "주의", item: `인력 부담 큼 (월 ${est.people}명)`, detail: `${est.months}개월 동안 약 ${est.mm}MM 투입`, core: true });
  else out.push({ level: "참고", item: `인력 감당 가능 (월 ${est.people}명)`, detail: `${est.months}개월 동안 약 ${est.mm}MM 투입`, core: true });
  // 기간
  if (est.months < 1) out.push({ level: "높음", item: `수행 기간 매우 짧음 (약 ${Math.round(est.months * 30)}일)`, detail: "작업량 대비 기간이 촉박합니다.", core: true });
  else if (est.months < 2 && est.mm > 3) out.push({ level: "주의", item: `수행 기간 빠듯함 (약 ${est.months}개월)`, detail: `총 ${est.mm}MM 작업을 ${est.months}개월 안에 해야 합니다.`, core: true });
  else out.push({ level: "참고", item: `수행 기간 약 ${est.months}개월`, detail: `총 ${est.mm}MM 작업`, core: true });
  return out;
}
