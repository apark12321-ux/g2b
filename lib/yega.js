// 예정가격(복수예가) 분포 · 투찰 시나리오 · 협상 가격점수 — 화면·서버 공용, 외부 호출 없음
//
// 복수예가 결정 구조 (나라장터 낙찰정보 236건 실측 확인, 2026-11)
//   1) 예비가격 15개 생성: 구간마다 무작위 1개
//      - 조달청 기준(±2%): 범위를 15개 균등 구간으로 분할 (50건 중 47건 일치)
//      - 행자부 기준(지자체 ±3%): 기초금액 미만 8구간 + 이상 7구간 (180건 중 179건 일치)
//   2) 개찰 시 15개 중 4개 추첨 → 4개 산술평균 = 예정가격
// 계산 가정: 추첨 4개는 15개 중 무작위 (추첨 번호는 값 순서와 무관하게 배정됨 · 실측 확인)
// 계산 방식: 구간별 균등분포 15개 중 4개 평균의 분포를 격자 동적계획으로 계산 (모의실험 없음)

const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** 예비가격 15개 구간 [시작, 끝] (%) */
export function intervalsOf(lo, hi) {
  const sym = Math.abs(lo + hi) < 1e-9;
  if (sym && Math.abs(hi - 3) < 1e-9) {
    // 행자부 기준: 기초금액 미만 8개 + 이상 7개
    const neg = Array.from({ length: 8 }, (_, i) => [lo + (i * -lo) / 8, lo + ((i + 1) * -lo) / 8]);
    const pos = Array.from({ length: 7 }, (_, i) => [(i * hi) / 7, ((i + 1) * hi) / 7]);
    return { scheme: "기초금액 미만 8구간 · 이상 7구간", verified: true, iv: [...neg, ...pos] };
  }
  const w = (hi - lo) / 15;
  return {
    scheme: "15개 균등 구간",
    verified: sym && Math.abs(hi - 2) < 1e-9,
    iv: Array.from({ length: 15 }, (_, i) => [lo + i * w, lo + (i + 1) * w]),
  };
}

/**
 * 사정률(예정가격 ÷ 기초금액 − 1, %) 분포
 * 구간 i의 예비가격 ~ U(a_i, b_i), 15개 중 4개 무작위 선택 평균
 * 동적계획: f[k](s) = 지금까지 k개 골랐을 때 합의 밀도 (격자 h)
 */
export function yegaModel(range) {
  const lo = Number(range?.lo), hi = Number(range?.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const { iv, scheme, verified } = intervalsOf(lo, hi);
  const h = (hi - lo) / 6000; // 합 격자 (사정률 환산 오차 0.0002%p 수준)
  const N = Math.round((4 * (hi - lo)) / h) + 2;
  // f[k]: 길이 N 확률질량 (합 = S0 + j*h)
  // g[k][j] = P(합 = k*lo + j*h)
  let g = Array.from({ length: 5 }, () => new Float64Array(N));
  g[0][0] = 1;
  for (const [a, b] of iv) {
    const ng = g.map((x) => Float64Array.from(x)); // 선택 안 함
    // 선택: 합에 U(a,b) 더함 → 원점 (k+1)*lo 기준 이동량 (a - lo)/h ~ (b - lo)/h
    const s = (a - lo) / h, e = (b - lo) / h, wdt = e - s;
    for (let k = 0; k < 4; k++) {
      const src = g[k];
      // 누적합으로 균등 커널 합성곱 (분수 끝점 선형 보간)
      const cum = new Float64Array(N + 1);
      for (let j = 0; j < N; j++) cum[j + 1] = cum[j] + src[j];
      const at = (x) => { if (x <= 0) return 0; if (x >= N) return cum[N]; const i = Math.floor(x); return cum[i] + (cum[i + 1] - cum[i]) * (x - i); };
      const dst = ng[k + 1];
      for (let j = 0; j < N; j++) {
        // 결과 칸 j ← 원래 칸이 [j - e, j - s] 범위 (칸 중앙 기준)
        const m = (at(j - s + 0.5) - at(j - e + 0.5)) / wdt;
        if (m) dst[j] += m;
      }
    }
    g = ng;
  }
  const pm = g[4];
  const tot = pm.reduce((s, v) => s + v, 0);
  // 사정률 x = (4*lo + j*h)/4 → 누적분포
  const cumP = new Float64Array(N + 1);
  for (let j = 0; j < N; j++) cumP[j + 1] = cumP[j] + pm[j] / tot;
  const cdf = (x) => {
    const t = (4 * x - 4 * lo) / h + 0.5; // 칸 j는 [j-0.5, j+0.5]
    if (t <= 0) return 0;
    if (t >= N) return 1;
    const i = Math.floor(t);
    return Math.min(1, cumP[i] + (cumP[i + 1] - cumP[i]) * (t - i));
  };
  const quant = (p) => {
    let a = lo, b = hi;
    for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (cdf(m) < p) a = m; else b = m; }
    return (a + b) / 2;
  };
  let mean = 0, m2 = 0;
  for (let j = 0; j < N; j++) { const x = (4 * lo + j * h) / 4, p = pm[j] / tot; mean += p * x; m2 += p * x * x; }
  const sd = Math.sqrt(Math.max(0, m2 - mean * mean));
  const edge = [quant(0.005), quant(0.995)];
  const step = (edge[1] - edge[0]) / 8;
  const bins = Array.from({ length: 8 }, (_, i) => {
    const from = edge[0] + i * step, to = from + step;
    return { from: r2(from, 3), to: r2(to, 3), p: cdf(to) - cdf(from) };
  });
  return {
    lo, hi, scheme, verified, cdf, quant, mean, sd, bins,
    q: { p10: quant(0.1), p25: quant(0.25), p50: quant(0.5), p75: quant(0.75), p90: quant(0.9) },
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
