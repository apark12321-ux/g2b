// 예정가격(복수예가) 분포 · 투찰 시나리오 · 협상 가격점수 — 화면·서버 공용, 외부 호출 없음
//
// 복수예가 결정 구조 (나라장터)
//   1) 예비가격 범위(기초금액 대비 lo~hi %)를 15개 균등 구간으로 분할, 구간마다 무작위 1개 → 예비가격 15개
//   2) 개찰 시 15개 중 4개 추첨 → 4개 산술평균 = 예정가격
// 계산 가정: 추첨 4개는 15개 중 무작위 (입찰자 번호 선택 쏠림 미반영)
// 모의실험 없이 정확한 분포 계산: 4개 구간 조합(1,365가지) × 균등분포 4개 합(Irwin-Hall)

const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };

/** Irwin-Hall(n=4) 누적분포: 0~1 균등분포 4개 합이 u 이하일 확률 */
function ih4(u) {
  if (u <= 0) return 0;
  if (u >= 4) return 1;
  let s = 0;
  for (let k = 0; k <= Math.floor(u); k++) s += (k % 2 ? -1 : 1) * C(4, k) * (u - k) ** 4;
  return s / 24;
}

/** 15개 구간 번호(0~14) 중 4개 조합의 번호 합 분포: K → 확률 */
const SUM_DIST = (() => {
  const cnt = new Map();
  for (let a = 0; a < 15; a++) for (let b = a + 1; b < 15; b++) for (let c = b + 1; c < 15; c++) for (let d = c + 1; d < 15; d++) {
    const k = a + b + c + d;
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  const total = C(15, 4);
  return [...cnt.entries()].map(([k, n]) => [k, n / total]);
})();

const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * 사정률(예정가격 ÷ 기초금액 − 1, %) 분포
 * @param {{lo:number, hi:number}} range 예비가격 범위 (%) 예: {lo:-2, hi:2}
 */
export function yegaModel(range) {
  const lo = Number(range?.lo), hi = Number(range?.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const w = (hi - lo) / 15;
  // P(사정률 ≤ x)
  const cdf = (x) => {
    if (x <= lo) return 0;
    if (x >= hi) return 1;
    const u = (4 * (x - lo)) / w;
    let s = 0;
    for (const [k, p] of SUM_DIST) s += p * ih4(u - k);
    return s;
  };
  const quant = (p) => {
    let a = lo, b = hi;
    for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (cdf(m) < p) a = m; else b = m; }
    return (a + b) / 2;
  };
  // 실제 예정가격이 몰리는 폭: 1~99% 구간을 8칸으로
  const edge = [quant(0.005), quant(0.995)];
  const step = (edge[1] - edge[0]) / 8;
  const bins = Array.from({ length: 8 }, (_, i) => {
    const from = edge[0] + i * step, to = from + step;
    return { from: r2(from, 3), to: r2(to, 3), p: cdf(to) - cdf(from) };
  });
  const sd = (() => {
    // 분산: 구간 조합 평균의 분산 + 균등분포 분산 (w²/12 × 4개 ÷ 16)
    const mean = SUM_DIST.reduce((s, [k, p]) => s + p * k, 0);
    const vK = SUM_DIST.reduce((s, [k, p]) => s + p * (k - mean) ** 2, 0);
    return (w / 4) * Math.sqrt(vK + 4 / 12);
  })();
  return {
    lo, hi, cdf, quant,
    q: { p10: quant(0.1), p25: quant(0.25), p50: quant(0.5), p75: quant(0.75), p90: quant(0.9) },
    sd, bins,
    within: (a, b) => cdf(b) - cdf(a),
  };
}

/** 사정률 x(%)일 때 예정가격 */
export const planAt = (bss, x) => bss * (1 + x / 100);

/**
 * 낙찰하한율 공고: 하한 통과 확률별 투찰 금액
 * 통과 = 투찰금액 ≥ 예정가격 × 하한율  ⇔  사정률 ≤ 투찰금액 ÷ (기초금액 × 하한율) − 1
 * 낮게 쓸수록 최저가 순위는 유리, 하한 미달 위험은 커짐
 */
export function floorScenarios(bss, lwlt, model, levels = [0.5, 0.7, 0.8, 0.9, 0.95, 1]) {
  if (!(bss > 0) || !(lwlt > 0 && lwlt < 100) || !model) return null;
  const L = lwlt / 100;
  const amountFor = (p) => Math.ceil(planAt(bss, p >= 1 ? model.hi : model.quant(p)) * L);
  const passProb = (amount) => model.cdf(amount / (bss * L) * 100 - 100);
  const rows = levels.map((p) => {
    const amount = amountFor(p);
    return { pass: p, amount, rateBss: r2((amount / bss) * 100, 3) };
  });
  return { rows, passProb };
}

/**
 * 협상에 의한 계약 가격점수 (국가계약 협상 기준 산식, 입찰가격이 추정가격 80% 이상 구간)
 *   가격점수 = 가격 배점 × (최저 입찰가격 ÷ 해당 입찰가격)
 * 최저가 대비 높게 쓴 비율별 점수 손실과, 같은 손실을 메우는 기술점수
 */
export function negoPriceTable(priceWeight, gaps = [0, 1, 2, 3, 5, 7, 10]) {
  const p = Number(priceWeight);
  if (!(p > 0 && p < 100)) return null;
  return gaps.map((g) => {
    const score = p * (100 / (100 + g));
    return { gap: g, score: r2(score), loss: r2(p - score) };
  });
}
