// 수주 가능성 점수: 리스크·적합도·수익성·경쟁 구도를 합쳐 0~100점으로 (규칙 기반 추정)
// 화면과 서버 양쪽에서 같이 씀
export function winScore(bid, a) {
  if (!a?.review) return null;
  const r = a.review;
  const reasons = [];
  let s = 60;
  const add = (n, why) => { s += n; reasons.push(`${n > 0 ? "+" : ""}${n} ${why}`); };

  // 1) 우리 회사 주력 분야와 맞는가
  const v = a.video || {};
  if (v.priority) add(20, "교수설계+영상 제작 (주력 분야)");
  else if ((v.share ?? 0) >= 50) add(10, "영상 제작 비중 높음");
  else if (v.low) add(-30, "영상 비중 10% 미만");

  // 2) 리스크
  const risks = (r.risks || []).filter((x) => !/직접\s*생산/.test(x.item));
  const hi = risks.filter((x) => x.level === "높음");
  const mid = risks.filter((x) => x.level === "주의");
  hi.forEach((x) => add(-20, x.item));
  mid.forEach((x) => add(-6, x.item));

  // 3) 수익성: 차시당 단가
  const per = String(r.unit || "").match(/약\s*([\d,]+)만원/);
  if (per && Number(per[1].replace(/,/g, "")) >= 200) add(5, "차시당 단가 넉넉함");

  // 4) 경쟁 구도: 기술 평가 비중이 높으면 제안서 품질로 승부 가능
  const ev = String(a.evaluation || "");
  const tech = ev.match(/기술\s*(?:능력)?\s*(?:평가)?\s*(\d{2})/);
  if (tech && Number(tech[1]) >= 80) add(5, `기술평가 ${tech[1]}점 (품질 경쟁)`);
  if (/(적격\s*심사|최저가)/.test(ev)) add(-8, "적격심사·최저가 (가격 경쟁, 업체 다수)");

  // 5) 근거 부족
  if (!(a.sources || []).length) add(-10, "첨부 문서 미확인");

  s = Math.max(0, Math.min(100, Math.round(s)));
  const grade = s >= 75 ? "A" : s >= 55 ? "B" : "C";
  const label = grade === "A" ? "적극 참여" : grade === "B" ? "조건부 참여" : "참여 비추천";
  return { score: s, grade, label, reasons };
}
