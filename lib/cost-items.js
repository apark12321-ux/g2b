// 제안요청서에서 '돈이나 품이 더 드는 요구사항'을 찾아 비용 항목으로 만듦 (근거 문장 포함)
//  type "expense": 외부로 나가는 돈 → 직접경비에 더함
//  type "labor":   우리 인력이 더 일해야 함 → 해당 역할 투입(M/M)에 더함 (돈 중복 계산 안 함)

export const ITEMS = [
  // 외부 지출
  { key: "studio", type: "expense", label: "외부 스튜디오 대관", re: /(외부\s*스튜디오|스튜디오\s*(?:대관|임차|임대))/, calc: (c) => c.shootDays * 600000, how: "촬영일 × 60만원" },
  { key: "advisor", type: "expense", label: "외부 전문가 자문·감수료", re: /(자문료|자문비|자문\s*위원|전문가\s*자문|외부\s*전문가|내용\s*전문가\s*(?:섭외|활용))/, calc: (c) => Math.max(1500000, c.units * 30000), how: "단위당 3만원 (최소 150만원)" },
  { key: "talent", type: "expense", label: "출연료·강사료", re: /(출연료|강사료|모델\s*섭외|배우\s*섭외|리포터|진행자\s*섭외|출연자\s*섭외|전문\s*강사\s*섭외)/, calc: (c) => c.videos * 500000 + c.lectures * 50000, how: "영상 편당 50만원·강의 차시당 5만원" },
  { key: "voice", type: "expense", label: "성우·내레이션 녹음", re: /(성우|더빙|나레이션\s*녹음|내레이션\s*녹음|내레이션)/, calc: (c) => c.narrMinutes * 10000, how: "내레이션 분량 1분당 1만원 (편집 영상 제외)" },
  { key: "translate", type: "expense", label: "번역·외국어 자막", re: /((?:영문|영어|외국어|다국어|중국어|일본어)\s*(?:자막|번역|더빙)|번역)/, calc: (c) => c.minutes * 12000, how: "1분당 1.2만원" },
  { key: "access", type: "expense", label: "수어·화면해설·폐쇄자막", re: /(수어|화면\s*해설|폐쇄\s*자막|배리어\s*프리)/, calc: (c) => c.minutes * 20000, how: "1분당 2만원" },
  { key: "license", type: "expense", label: "음원·폰트·이미지 라이선스", re: /((?:음원|배경\s*음악|BGM|폰트|서체|스톡|이미지|영상\s*소스)\s*(?:구매|라이선스|사용료|확보|저작권)|저작권\s*(?:확보|처리|해결))/, calc: (c) => 2000000 + c.units * 10000, how: "기본 200만원 + 단위당 1만원" },
  { key: "special", type: "expense", label: "특수촬영(드론·짐벌·크레인)", re: /(드론|항공\s*촬영|수중\s*촬영|지미집|크레인|타임랩스|360\s*도)/, calc: (c) => 1000000 + c.videos * 300000, how: "기본 100만원 + 편당 30만원" },
  { key: "gear", type: "expense", label: "고사양 장비 렌탈(4K 이상 등)", re: /(4K|8K|UHD|시네마\s*카메라|멀티\s*캠|다중\s*카메라)/, calc: (c) => c.shootDays * 200000, how: "촬영일 × 20만원" },
  { key: "travel", type: "expense", label: "현장·지방 촬영 출장", re: /(현장\s*촬영|로케이션|출장|지방\s*촬영|전국\s*\d*\s*개?\s*(?:지역|현장))/, calc: (c) => c.shootDays * 250000, how: "촬영일 × 25만원(교통·숙박·식대)" },
  { key: "review", type: "expense", label: "심의·품질인증·외부 검수 비용", re: /((?<!중)심의(?:료|비|위원)|품질\s*인증|인증비|인증\s*심사|검수\s*위원|내용\s*심사|외부\s*(?:검토|감수)|감수(?!성))/, calc: () => 3000000, how: "300만원" },
  { key: "meeting", type: "expense", label: "보고회·시연회·워크숍", re: /(착수\s*보고|중간\s*보고|완료\s*보고|최종\s*보고|시연회|시사회|워크숍|품평회|보고회)/, calc: (c) => c.meetings * 300000, how: "회당 30만원" },
  { key: "print", type: "expense", label: "인쇄·제본·납품 매체", re: /(인쇄물|인쇄\s*(?:제작|본|하여|납품|부수)|제본|책자\s*(?:제작|인쇄|발간)|외장\s*하드|DVD|납품\s*매체)/, calc: () => 1000000, how: "100만원" },
  { key: "server", type: "expense", label: "개발 사이트·서버·호스팅", re: /(개발\s*사이트|테스트\s*서버|호스팅|클라우드\s*(?:서버|임차|이용)|서버\s*(?:구축|임차|운영|구매))/, calc: (c) => c.months * 300000, how: "월 30만원" },
  { key: "bond", type: "expense", label: "보증보험(계약·하자이행)", re: /(계약\s*보증|이행\s*보증|하자\s*(?:이행\s*)?보증|보증\s*보험)/, calc: (c) => (c.price || 0) * 0.005, how: "계약금액의 0.5%" },
  // 우리 인력이 더 일하는 것
  { key: "warranty", type: "labor", role: ["PM", "고급"], label: "하자보수 기간 대응", re: /((?:무상\s*)?하자\s*보수\s*(?:기간)?|유지\s*보수\s*(?:기간)?)[^.\n]{0,20}?(\d+)\s*(년|개월)/, mm: (c, m) => (m && m[3] === "년" ? Number(m[2]) * 12 : Number(m?.[2] || 12)) * 0.03, how: "보수 기간 월 0.03M/M" },
  { key: "privacy", type: "labor", role: ["편집", "중급"], label: "비식별(모자이크) 처리", re: /(비식별|모자이크|블러|얼굴\s*가림)/, mm: (c) => c.videos * 0.02 + c.lectures * 0.005, how: "영상 편당 0.02M/M" },
  { key: "quiz", type: "labor", role: ["교수설계·원고", "고급"], label: "평가문항·퀴즈 집필", re: /(평가\s*문항|형성\s*평가|총괄\s*평가|퀴즈)/, mm: (c) => c.units * 0.01, how: "단위당 0.01M/M" },
  { key: "material", type: "labor", role: ["디자인·모션", "중급"], label: "교재·워크북·학습자료 제작", re: /((?:교재|워크북|학습\s*자료|보조\s*교재|요약\s*자료)\s*(?:제작|개발|집필))/, mm: (c) => c.units * 0.02, how: "단위당 0.02M/M" },
  { key: "storyboard", type: "labor", role: ["교수설계·원고", "고급"], label: "구성안·스토리보드·대본 작성", re: /(스토리보드|구성안|대본|원고\s*작성|시나리오)/, mm: (c) => c.videos * 0.03, how: "영상 편당 0.03M/M (이러닝 차시는 기본 포함)" },
];

/** 문서에서 비용 항목 찾기 → { items: [{ key, label, type, evidence, m }], meetings } */
export function findCostItems(docText) {
  const lines = String(docText || "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 6 && l.length <= 300);
  const out = [];
  for (const it of ITEMS) {
    const line = lines.find((l) => it.re.test(l));
    if (!line) continue;
    const m = line.match(it.re);
    out.push({ key: it.key, label: it.label, type: it.type, evidence: line.length > 120 ? line.slice(0, 119) + "…" : line, m: m ? [...m] : null });
  }
  const meetings = new Set((String(docText).match(/(착수|중간|완료|최종)\s*보고|시연회|시사회|워크숍|품평회/g) || []).map((x) => x.replace(/\s/g, ""))).size;
  return { items: out, meetings: Math.max(meetings, out.some((x) => x.key === "meeting") ? 2 : 0) };
}
