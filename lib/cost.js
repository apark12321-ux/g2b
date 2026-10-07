// 원가·마진 추정 (규칙 기반). 아래 기준값은 회사 실제 단가에 맞춰 조정하세요.
export const COST = {
  monthlyLabor: 5000000,   // 1인 월 인건비(회사 부담분 포함) 평균
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

/** 산출물 수량: 차시 > 편 > 숏폼 순으로 찾음 */
function units(a) {
  const text = [...(a.deliverables || []), ...(a.tasks || [])].join(" ");
  const max = (re) => Math.max(0, ...[...text.matchAll(re)].map((x) => Number(x[1])));
  const chasi = max(/(\d{1,4})\s*차시/g);
  if (chasi >= 2) return { kind: "차시", n: chasi };
  const shorts = max(/(?:쇼츠|숏폼|숏츠)[^\d]{0,10}(\d{1,3})\s*(?:편|개|건)/g);
  const pyeon = max(/(\d{1,3})\s*편/g);
  if (pyeon >= 1) return { kind: shorts && shorts === pyeon ? "쇼츠" : "편", n: pyeon };
  return null;
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
export function estimateCost(bid, a) {
  if (!a) return null;
  const mo = months(a.period) || COST.defaultMonths;
  const u = units(a);
  const sc = staffCount(a);
  let mm, direct, basis;
  if (u) {
    const k = COST.units[u.kind];
    mm = u.n * k.mm;
    direct = u.n * k.direct;
    basis = `${k.label} ${u.n}개 기준 (단위당 ${k.mm}MM, 직접경비 ${won(k.direct)})`;
  } else if (sc) {
    mm = sc * mo * 0.6; // 문서상 인력이 기간 동안 평균 60% 투입
    direct = mm * 300000;
    basis = `문서상 투입인력 ${sc}명 × ${mo}개월 × 투입률 60% 기준`;
  } else {
    return { unknown: true, months: mo, notes: ["납품 수량과 투입 인력을 문서에서 찾지 못해 원가를 추정하지 못했습니다."] };
  }
  // 문서가 요구하는 최소 인력보다 적게 잡지 않음
  if (sc) mm = Math.max(mm, sc * mo * 0.4);
  const labor = mm * COST.monthlyLabor;
  const sub = labor + direct;
  const overhead = sub * COST.overhead;
  const total = sub + overhead;
  const supply = bid.price || null; // 나라장터 추정가격은 부가세 제외 금액
  const margin = supply ? (supply - total) / supply : null;
  const people = mm / mo;
  const notes = [];
  if (people > COST.teamMax) notes.push(`기간 안에 끝내려면 월 평균 ${people.toFixed(1)}명이 필요해 회사 가용 인력(${COST.teamMax}명)을 넘습니다.`);
  return {
    mm: Math.round(mm * 10) / 10,
    people: Math.round(people * 10) / 10,
    months: mo,
    cost: { labor, direct, overhead, total },
    supply,
    margin,
    basis,
    notes,
    fmt: { labor: won(labor), direct: won(direct), overhead: won(overhead), total: won(total), supply: supply ? won(supply) : "미공개" },
  };
}

/** 마진 판정 → 리스크 항목 */
export function costRisks(est) {
  const out = [];
  if (!est || est.unknown) return out;
  if (est.margin !== null) {
    const pct = Math.round(est.margin * 100);
    if (pct < 0) out.push({ level: "높음", item: `적자 예상 (마진 ${pct}%)`, detail: `원가 약 ${est.fmt.total} > 추정가격 ${est.fmt.supply}` });
    else if (pct < 10) out.push({ level: "주의", item: `마진 낮음 (약 ${pct}%)`, detail: `원가 약 ${est.fmt.total} / 추정가격 ${est.fmt.supply}` });
  }
  if (est.people > COST.teamMax) out.push({ level: "높음", item: `인력 과부하 (월 ${est.people}명 필요)`, detail: est.notes[0] });
  else if (est.people > COST.teamMax * 0.7) out.push({ level: "주의", item: `인력 부담 큼 (월 ${est.people}명)`, detail: `${est.months}개월 동안 약 ${est.mm}MM 투입` });
  return out;
}
