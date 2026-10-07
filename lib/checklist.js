// 입찰 전 확인: 1단계(입찰 가능 여부) → 2단계(경영지원팀 제출 준비, 순서대로)
import { dropToc } from "./basic-extract";
const cut = (x, n = 120) => (x && x.length > n ? x.slice(0, n - 1) + "…" : x || "");

export function buildChecklist(docText, bid = {}, a = {}, meta = {}) {
  const lines = dropToc(String(docText || "")).split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 4 && l.length <= 300);
  const find = (re) => lines.find((l) => re.test(l));
  const findAll = (re, n = 6) => [...new Set(lines.filter((l) => re.test(l)))].slice(0, n);

  // ── 1단계: 입찰 가능 여부
  const gate = [];
  let codes = findAll(/업종\s*코드\s*[:：]?\s*\d{4}/).filter((l) => !/직접\s*생산/.test(l));
  if (!codes.length) codes = findAll(/((?:등록|신고)\s*(?:된|한)?\s*업체|소프트웨어\s*사업자|업종\s*(?:을|으로)?\s*등록)/).filter((l) => !/(직접\s*생산|법률|시행령|시행규칙)/.test(l));
  if (codes.length) gate.push({ id: "g-license", item: "입찰참가자격(업종 등록)을 갖고 있는가", detail: "아래 중 하나 이상 등록·보유 (입찰마감 전일까지)", evidence: codes.map((x) => cut(x, 90)) });
  if (bid.region && bid.region !== "전국") gate.push({ id: "g-region", item: `참가 가능 지역에 해당하는가 (${bid.region})`, detail: /서울/.test(bid.region) ? "서울 포함 → 본사 소재지 확인" : "서울 외 지역 제한", evidence: [] });
  const perf = find(/(수행\s*실적|납품\s*실적|실적\s*제한)[^.]{0,80}(이상|보유|이내|있는)/) || find(/최근\s*\d+\s*년\s*이내[^.]{0,60}실적/);
  if (perf) gate.push({ id: "g-perf", item: "요구 실적을 충족하는가", detail: "금액·기간·분야·발주처 조건을 실적증명서로 증빙 가능한지", evidence: [cut(perf)] });
  const brief = find(/(현장\s*설명회|사업\s*설명회)[^.]{0,40}(참석|참가)[^.]{0,30}(필수|하여야|한하여|자에\s*한)/);
  if (brief || meta.dcmtgOprtnDt) {
    const when = meta.dcmtgOprtnDt ? String(meta.dcmtgOprtnDt).slice(5, 16).replace("-", ".") : "";
    const passed = meta.dcmtgOprtnDt && new Date(String(meta.dcmtgOprtnDt).replace(" ", "T") + "+09:00") < new Date();
    gate.push({ id: "g-brief", item: `현장설명회에 참석했는가${when ? ` (${when})` : ""}`, detail: passed ? "설명회가 이미 지났습니다 — 필수라면 입찰 불가" : "필수 참석이면 불참 시 입찰 불가", evidence: brief ? [cut(brief)] : [], level: passed ? "block" : "check" });
  }
  const jvLines = lines.filter((l) => !/(인력|구성원을?\s*변경|부정당)/.test(l));
  const jv = jvLines.find((l) => /공동\s*(?:수급|계약|도급)[^.]{0,12}(불허|불가|허용하지\s*않|금지)/.test(l)) || jvLines.find((l) => /공동\s*(?:수급|계약|도급)[^.]{0,12}(허용|가능)/.test(l));
  if (jv) gate.push({ id: "g-jv", item: /불허|불가|않|금지/.test(jv) ? "단독으로 수행 가능한가 (공동수급 불허)" : "공동수급 필요 시 파트너가 있는가", detail: "", evidence: [cut(jv)] });
  const sme = find(/(중소기업|소기업|소상공인)[^.]{0,20}(만|에\s*한|제한|으로\s*제한)/);
  if (sme) gate.push({ id: "g-sme", item: "중소기업·소기업 제한에 해당하는가", detail: "중소기업(소기업)확인서 유효기간 확인", evidence: [cut(sme)] });
  const pm = find(/(사업\s*관리자|사업\s*책임자|PM)[^.]{0,60}(경력|자격|재직|기술사|특급|고급)/);
  if (pm) gate.push({ id: "g-pm", item: "PM(사업책임자) 요건을 충족하는 인력이 있는가", detail: a.presenter ? `발표: ${a.presenter}` : "재직 기간·경력·자격 증빙", evidence: [cut(pm)] });
  const credit = find(/신용\s*평가\s*등급[^.]{0,30}(이상|미만|제한)/);
  if (credit) gate.push({ id: "g-credit", item: "신용평가등급 기준을 충족하는가", detail: "", evidence: [cut(credit)] });
  if (bid.close_at) {
    const left = Math.floor((new Date(bid.close_at) - Date.now()) / 864e5);
    gate.push({ id: "g-time", item: `제안서 준비 기간이 충분한가 (마감까지 ${Math.max(0, left)}일)`, detail: left < 7 ? "7일 미만 — 제안서·서류 준비가 빠듯함" : "", evidence: [], level: left < 3 ? "block" : "check" });
  }

  // ── 2단계: 경영지원팀이 순서대로 체크 (입찰 실패 방지)
  const prep = [];
  const add = (id, item, detail, evidence = []) => prep.push({ id, item, detail, evidence: evidence.filter(Boolean).map((x) => cut(x, 100)) });
  add("p-g2b", "나라장터 입찰참가자격 등록·업종 등록 확인", "필요한 업종이 '입찰마감 전일'까지 등록돼 있어야 함", codes.slice(0, 2));
  add("p-cert", "전자입찰용 공동인증서·대표자/입찰대리인 신원확인 준비", "인증서 유효기간, 지문 등 신원확인 수단 확인", [find(/신원\s*확인|인증서/)]);
  // 제출 서류: 문서의 번호 목록을 그대로
  const docIdx = lines.findIndex((l) => /(아래|다음)\s*서류를?\s*(반드시\s*)?제출|제출\s*서류|구비\s*서류/.test(l));
  const docs = [];
  if (docIdx >= 0) for (let j = docIdx + 1; j < lines.length && docs.length < 12; j++) {
    if (/^(\d{1,2}\)|\d{1,2}\.|[가-하]\.|[①-⑳]|-|◦|○)\s*/.test(lines[j]) && /(서|본|증|원|부|식|서식|확인서|명부)/.test(lines[j])) docs.push(lines[j].replace(/^(\d{1,2}\)|\d{1,2}\.|[①-⑳]|-|◦|○)\s*/, ""));
    else if (docs.length) break;
  }
  add("p-docs", "제출 서류 준비", docs.length ? `문서 기준 ${docs.length}종` : "입찰참가신청서, 사업자등록증, 법인등기부등본·인감증명서, 실적증명서, 신용평가등급확인서 등", docs);
  add("p-perf", "실적증명서·정량평가 증빙 발급", "실적증명원(발주처 발급), 신용평가등급확인서 유효기간, 투입인력 경력·재직증명서", [perf, find(/경력\s*증명서|재직\s*증명/)]);
  const pages = find(/(\d{1,3})\s*(?:쪽|페이지|매)\s*(?:이내|이하|내외)/), fmt = find(/(A4|글자\s*크기|폰트|PDF|HWP)[^.]{0,40}(작성|제출|형식)/);
  add("p-proposal", "제안서·제안요약서 작성 (분량·형식 준수)", "분량·용지·글자 크기·파일 형식 위반 시 감점·실격", [pages, fmt]);
  add("p-forms", "별지 서식 작성·날인 (청렴·보안·확약서 등)", "", [find(/별지\s*(?:제\s*)?\d+\s*호/)]);
  add("p-price", "가격 제안·전자 투찰 (마감 일시 엄수)", "예정가격 범위·낙찰하한율 확인, 투찰은 마감 하루 전 완료 권장", [find(/투찰|가격\s*제안서|입찰서\s*제출/)]);
  add("p-bond", "입찰보증금(지급각서)·계약보증금 준비", "", [find(/입찰\s*보증금|보증금\s*납부/)]);
  if (a.presenter) add("p-present", "제안 발표 준비", `${a.presenter}${a.schedule?.length ? " · " + a.schedule.slice(0, 2).join(", ") : ""}`, [find(/발표\s*(?:일시|순서|시간)/)]);
  add("p-final", "마감 전일 최종 점검", "제출 파일 열림·서명 확인, 나라장터 제출 완료 화면 캡처", []);
  return { gate, prep };
}
