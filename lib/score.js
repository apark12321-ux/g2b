import { titleVideoOnly } from "./video-score";
import { estimateCost, costRisks } from "./cost";
import { cashNeed } from "./payment";

// 이미 아는 계약 일반조건 (리스크에서 제외)
export const BOILERPLATE = /(직접\s*생산|업종\s*등록|신고\s*요건|무상|추가\s*요구|지체\s*상금|손해\s*배상|하자\s*보수|공동\s*수급|기술\s*평가\s*비중|차시당\s*단가)/;

/** 화면·점수에 쓰는 리스크 목록: 일반조건 제외 + 원가·인력 리스크 추가 */
export function reviewRisks(bid, a, model) {
  const est = estimateCost(bid, a, model);
  const core = costRisks(est);
  // 운영 이슈: 대금 지급 방식에 따른 자금 부담
  const cash = cashNeed(a?.payment, est);
  if (cash) {
    const won = est.won;
    const lvl = cash.peak > 100000000 ? "주의" : "참고";
    core.push({ level: cash.adv > 0 ? "참고" : lvl, item: `자금 선투입 약 ${won(cash.peak)} (${cash.method})`, detail: `대금 수령까지 약 ${Math.round(cash.waitMonths * 10) / 10}개월${cash.assumed ? " · 문서에 지급 조건 없음(후불 가정)" : ""}`, core: true });
  }
  const hasPeriod = core.some((x) => /기간/.test(x.item));
  const base = (a?.review?.risks || [])
    .filter((x) => !BOILERPLATE.test(`${x.item}`))
    .filter((x) => !(hasPeriod && /수행 기간|기간 짧음|기간 매우/.test(x.item))) // 기간은 핵심 행으로 통일
    .map((x) => (/하도급/.test(x.item) ? { ...x, level: "참고" } : x)); // 하도급은 언급만
  const order = { 높음: 0, 주의: 1, 참고: 2 };
  return [...core, ...base.sort((x, y) => (order[x.level] ?? 2) - (order[y.level] ?? 2))];
}
// 수주 가능성 점수: 리스크·적합도·수익성·경쟁 구도를 합쳐 0~100점으로 (규칙 기반 추정)
// 화면과 서버 양쪽에서 같이 씀
export function winScore(bid, a, model) {
  if (!a?.review) return null;
  const r = a.review;
  const reasons = [];
  let s = 60;
  const add = (n, why) => { s += n; reasons.push(`${n > 0 ? "+" : ""}${n} ${why}`); };

  // 1) 우리 회사 주력 분야와 맞는가
  const v = a.video || {};
  if (v.only ?? titleVideoOnly(bid?.title)) add(30, "영상 제작만 하는 공고 (최우선)");
  else if (v.priority) add(20, "교수설계+영상 제작 (주력 분야)");
  else if ((v.share ?? 0) >= 50) add(10, "영상 제작 비중 높음");
  else if (v.low) add(-30, "영상 비중 10% 미만");

  // 2) 리스크
  const risks = reviewRisks(bid, a, model);
  const hi = risks.filter((x) => x.level === "높음");
  const mid = risks.filter((x) => x.level === "주의");
  hi.forEach((x) => add(-20, x.item));
  mid.forEach((x) => add(-6, x.item));

  // 3) 수익성: 추정 마진 (적자·저마진은 리스크로 이미 감점)
  const est = estimateCost(bid, a, model);
  if (est && est.margin !== null) {
    const pct = Math.round(est.margin * 100);
    if (pct >= 20) add(10, `예상 마진 ${pct}%`);
    else if (pct >= 10) add(5, `예상 마진 ${pct}%`);
  }

  // 4) 경쟁 구도: 기술 평가 비중이 높으면 제안서 품질로 승부 가능
  const ev = String(a.evaluation || "");
  const tech = ev.match(/기술\s*(?:능력)?\s*(?:평가)?\s*(\d{2})/);
  if (tech && Number(tech[1]) >= 80) add(5, `기술평가 ${tech[1]}점 (품질 경쟁)`);
  if (/(적격\s*심사|최저가)/.test(ev)) add(-8, "적격심사·최저가 (가격 경쟁, 업체 다수)");

  // 5) 근거 부족
  if (!(a.sources || []).length) add(-10, "첨부 문서 미확인");

  // 분량을 문서에서 확인하지 못한 경우: 마진이 맞는지 알 수 없으므로 '적극 참여'를 주지 않음
  if (est && est.confidence === "낮음" && s > 64) {
    reasons.push(`상한 64점: 분량·원가 근거 부족 (제안요청서 확인 필요)`);
    s = 64;
  }
  s = Math.max(0, Math.min(100, Math.round(s)));
  const grade = s >= 75 ? "A" : s >= 55 ? "B" : "C";
  const label = grade === "A" ? "적극 참여" : grade === "B" ? "조건부 참여" : "참여 비추천";
  return { score: s, grade, label, reasons };
}
