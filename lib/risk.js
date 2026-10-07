// 입찰 리스크 점검: 무모한 입찰을 걸러내기 위한 규칙 기반 판단
import { sentencesOf } from "./basic-extract";

const n = (s) => String(s || "").replace(/\s+/g, " ").trim();
const cut = (s, k = 160) => (s.length > k ? s.slice(0, k - 1) + "…" : s);
const DAY = 864e5;

function parseKDate(s) {
  const m = String(s || "").match(/(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  return m ? new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T18:00:00+09:00`) : null;
}

/**
 * bid: 공고, docText: 첨부 문서 전체 글자, a: 분석 결과(tasks, deliverables, staff, evaluation, period, presentation)
 * → { verdict: {level, tone, reason}, risks: [{level, item, detail}], unit, checklist }
 */
export function riskReview(bid, docText, a) {
  const sents = sentencesOf(docText || "").map(n);
  const find = (...res) => sents.find((s) => res.every((r) => r.test(s)));
  const risks = [];
  const add = (level, item, detail = "") => {
    if (!risks.some((r) => r.item === item)) risks.push({ level, item, detail: cut(n(detail)) });
  };

  // 1) 참가 자체가 막힐 수 있는 조건
  let s;
  if ((s = find(/현장\s*설명회/, /(참석|참가)/, /(필수|하여야|않은\s*자|불참|무효|제한|자에\s*한)/)))
    add("높음", "현장설명회 참석 필수", s);
  if ((s = find(/(지역\s*제한|소재지|본사|주된\s*영업소)/, /(제한|소재한|두고\s*있는|한정|소재하는)/, /(입찰|참가|자격|업체)/))) {
    if (/서울/.test(s) || /서울/.test(bid.region || "")) add("참고", "서울 지역 제한 (참가 가능)", s);
    else add("높음", "지역 제한", s);
  }
  if ((s = find(/실적/, /(이상|보유|있는\s*자|증명|있는\s*업체)/))) add("주의", "수행 실적 요건", s);
  if ((s = find(/(소프트웨어\s*사업자|디지털\s*콘텐츠|이러닝\s*(?:사업자|산업)|정보통신|출판사|영상\s*제작업|면허|등록\s*(?:업체|된\s*자))/, /(등록|신고|보유|면허)/)))
    add("참고", "업종 등록·신고 요건", s);

  // 2) 수행하면서 손해가 날 수 있는 조건
  if ((s = find(/하도급/, /(불가|금지|할\s*수\s*없|불허|승인)/))) add("주의", "하도급 제한", s);
  if ((s = find(/상주/))) add("주의", "인력 상주 요구", s);
  if ((s = find(/(무상|추가\s*비용\s*없이|추가\s*비용\s*부담|요구하는\s*경우|요청\s*시\s*(?:즉시|무상)|별도\s*비용\s*없이)/)))
    add("주의", "추가 요구·무상 작업 가능성", s);
  if ((s = find(/(지체\s*상금|위약금|손해\s*배상)/))) add("참고", "지체상금·손해배상 조항", s);
  if ((s = find(/하자\s*보수/, /\d+\s*(년|개월)/))) add("참고", "하자보수 기간", s);
  if ((s = find(/공동\s*수급/, /(불허|불가|허용하지|않음)/))) add("참고", "공동수급 불가", s);

  // 3) 평가 방식: 가격 경쟁 비중
  const ev = n(a.evaluation || "") + " " + (find(/(기술|가격)\s*(?:능력)?\s*(?:평가)?\s*\d{1,2}/) || "");
  const price = ev.match(/가격\s*(?:평가)?\s*(\d{1,2})\s*(?:점|%)?/);
  if (/(적격\s*심사|최저가|최저\s*가격)/.test(ev) || (price && Number(price[1]) >= 30))
    add("주의", "가격 경쟁 비중 높음", ev);
  const tech = ev.match(/기술\s*(?:능력)?\s*(?:평가)?\s*(\d{2})/);
  if (tech && Number(tech[1]) >= 80) add("참고", `기술 평가 비중 ${tech[1]}점 (제안서 품질이 관건)`, "");

  // 4) 일정: 준비 기간, 수행 기간
  if (bid.close_at) {
    const left = Math.floor((new Date(bid.close_at) - Date.now()) / DAY);
    if (left >= 0 && left < 10) add("주의", `제안 준비 기간 짧음 (마감까지 ${left}일)`, "");
  }
  const end = parseKDate(a.period);
  if (end) {
    const days = Math.round((end - Date.now()) / DAY);
    if (days > 0 && days < 60) add("높음", `수행 기간 매우 짧음 (약 ${days}일)`, a.period);
    else if (days > 0 && days < 100) add("주의", `수행 기간 짧음 (약 ${days}일)`, a.period);
  }

  // 5) 단가: 예산 ÷ 차시(또는 편) 수
  let unit = null;
  const pool = [...(a.deliverables || []), ...(a.tasks || [])].join(" ");
  const budget = bid.price || null;
  const chasi = Math.max(0, ...[...pool.matchAll(/(\d{1,4})\s*차시/g)].map((m) => Number(m[1])));
  const pyeon = Math.max(0, ...[...pool.matchAll(/(\d{1,3})\s*편/g)].map((m) => Number(m[1])));
  if (budget && chasi >= 2) {
    const per = Math.round(budget / chasi);
    unit = `차시당 약 ${Math.round(per / 10000).toLocaleString("ko-KR")}만원 (${chasi}차시, 부가세 포함 예산 기준)`;
    if (per < 800000) add("높음", "차시당 단가 매우 낮음", unit);
    else if (per < 1500000) add("주의", "차시당 단가 낮은 편", unit);
  } else if (budget && pyeon >= 1) {
    unit = `편당 약 ${Math.round(budget / pyeon / 10000).toLocaleString("ko-KR")}만원 (${pyeon}편 기준)`;
  }

  // 6) 인력·발표
  const staff = (a.staff || []).map((x) => (typeof x === "string" ? x : `${x.role} ${x.detail || ""}`)).join(" ");
  if (/(박사|기술사|PMP|특급|고급\s*기술자)/.test(staff)) add("주의", "인력 자격 요건 높음", staff);
  if ((a.staff || []).length >= 6) add("주의", `투입 인력 요구 많음 (${a.staff.length}개 항목)`, "");
  const pres = (a.presentation || []).join(" ");
  if (/(대리\s*발표[^.]*?(불가|인정하지|않)|PM|사업책임자|책임자가\s*직접)/.test(pres))
    add("참고", "PM(사업책임자) 직접 발표 필요", (a.presentation || []).find((x) => /PM|책임자|대리/.test(x)) || "");

  if (!docText || docText.replace(/\s/g, "").length < 300)
    add("주의", "첨부 문서를 충분히 읽지 못함", "자격·과업 조건은 첨부파일을 직접 확인해야 합니다.");

  // 판단
  const order = { 높음: 0, 주의: 1, 참고: 2 };
  risks.sort((x, y) => order[x.level] - order[y.level]);
  const high = risks.filter((r) => r.level === "높음");
  const warn = risks.filter((r) => r.level === "주의");
  let verdict;
  if (high.length >= 2 || high.some((r) => /단가 매우 낮음|기간 매우 짧음/.test(r.item)))
    verdict = { level: "무리한 입찰 주의", tone: "bad", reason: high.map((r) => r.item).join(", ") };
  else if (high.length === 1 || warn.length >= 3)
    verdict = { level: "조건 확인 후 입찰", tone: "warn", reason: [...high, ...warn].slice(0, 3).map((r) => r.item).join(", ") };
  else verdict = { level: "입찰 검토 권장", tone: "good", reason: warn.length ? `확인할 점: ${warn.map((r) => r.item).join(", ")}` : "큰 위험 요소가 보이지 않습니다." };

  const checklist = [];
  const has = (k) => risks.some((r) => r.item.includes(k));
  if (has("실적")) checklist.push("우리 회사 실적이 요구 금액·기간 조건을 충족하는지");
  if (has("지역")) checklist.push("본사 소재지가 지역 제한에 해당하는지");
  if (has("현장설명회")) checklist.push("현장설명회 일시·장소와 참석 가능 여부");
  if (has("업종")) checklist.push("필요한 업종 등록·신고증 보유 여부");
  if (has("단가")) checklist.push("차시당 제작 원가를 계산해 예산 안에서 수익이 나는지");
  if (has("하도급")) checklist.push("촬영·디자인 등 외주 없이 자체 수행 가능한지");
  if (has("PM")) checklist.push("PM이 발표일에 직접 참석할 수 있는지");
  if (has("상주")) checklist.push("상주 인력을 배치할 여력이 있는지");
  if (has("기간")) checklist.push("수행 기간 안에 납품물 전체 제작이 가능한지");

  return { verdict, risks, unit, checklist };
}
