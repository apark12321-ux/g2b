// 핵심 검토 항목 — 입찰 가능 여부·평가 방식·과업 규모·계약 조건을 문서에서 정확히 도출
// 1) 공고문·제안요청서 등 원문을 AI가 읽어 항목별 '값 + 원문 인용'을 냄
// 2) 인용이 실제 문서에 그대로 있는지, 값의 숫자가 문서에 있는지 서버에서 대조
// 3) 대조를 통과한 값만 화면에 씀 (통과 못 하면 "문서에서 확인되지 않음")
import { askJson } from "./ai";

const NONE = "문서에서 확인되지 않음";
const MAX_CHARS = 220000;
const cut = (x, n = 200) => { const t = String(x || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const won = (n) => (n ? `${Number(n).toLocaleString("ko-KR")}원` : "");

// ── 원문 대조용 정규화: 공백·괄호·따옴표·가운뎃점 차이는 무시
const norm = (s) => String(s || "").normalize("NFC")
  .replace(/[\s 　·ㆍ•∙‧・「」『』"'“”‘’()（）\[\]［］<>〈〉《》【】{}:：;,，.。…~∼〜\-–—_/\\|※○◦□■▣▶►◆◇●*#]/g, "")
  .toLowerCase();
const digits = (s) => String(s || "").replace(/(\d),(?=\d{3})/g, "$1");

/** 문서 정리: 같은 문서의 HWP·PDF 중복은 하나만, 공고문·제안요청서·과업지시서 우선 */
export function prepDocs(files) {
  const rank = (n) => (/공고/.test(n) ? 0 : /제안\s*요청/.test(n) ? 1 : /과업|지시|내용서|사업\s*안내|규격/.test(n) ? 2 : /평가|배점/.test(n) ? 3 : 4);
  const stem = (n) => String(n).replace(/^\[이전 공고[^\]]*\]\s*/, "").replace(/\.(hwpx?|pdf|docx?)$/i, "").replace(/\s+/g, "");
  const byStem = new Map();
  for (const f of files || []) {
    const text = String(f.text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (text.replace(/\s/g, "").length < 50) continue;
    const k = stem(f.name);
    const prev = byStem.get(k);
    if (!prev || text.length > prev.text.length) byStem.set(k, { name: f.name, text });
  }
  const docs = [...byStem.values()].sort((a, b) => rank(a.name) - rank(b.name));
  let budget = MAX_CHARS;
  return docs.map((d) => { const t = d.text.slice(0, Math.max(0, budget)); budget -= t.length; return { ...d, text: t, n: norm(d.text), d: norm(digits(d.text)) }; }).filter((d) => d.text);
}

const PROMPT = (bid, docs) => `당신은 공공조달 입찰 심사 실무 전문가입니다. 아래 나라장터 입찰공고의 첨부 문서를 처음부터 끝까지 읽고, 입찰 참여 여부를 판단하는 데 필요한 핵심 항목을 정확히 추출하세요.

[절대 원칙]
1. 문서에 적힌 내용만 씁니다. 추측·일반론·상식으로 채우지 않습니다. 없으면 null.
2. value의 숫자·단위는 문서 표기를 그대로 씁니다(환산·반올림 금지). 모든 항목의 quote는 해당 내용을 담은 원문 문장을 한 글자도 바꾸지 않고 그대로 복사합니다(40~200자). 요약·의역·여러 문장 이어 붙이기 금지.
3. source는 quote를 가져온 첨부 파일 이름을 그대로 씁니다.
4. 입찰공고문(공고서)과 제안요청서가 다르면 입찰공고문을 우선하고 note에 차이를 적습니다.
5. 서식·작성 예시·법령 인용·목차·다른 사업 사례 문장은 이 사업의 조건이 아닙니다. 조건을 정하는 문장만 근거로 씁니다.

[판단 기준]
• 업종(license): 입찰참가자격의 업종·면허 등록 조건. 업종코드 4자리를 원문대로.
  relation: "모두"(모두 갖춘 자, A과 B, A 및 B, 각 호 모두) | "택일"(A 또는 B, 중 하나, 어느 하나 이상) | "단일"(하나뿐).
  판단 근거 문구가 애매하면 relation을 "불명확"으로 둡니다.
• 실적(record): kind는 다음 중 하나.
  "자격" = 실적이 없으면 입찰 참가 자체가 안 됨(참가자격 조항에 있음)
  "배점" = 기술평가(정량·정성) 점수 항목으로만 반영됨 → points에 배점 숫자
  "자격+배점" = 둘 다
  "제안서 기재" = 제안서에 실적을 적게 하지만 별도 배점·자격은 없음
  "없음" = 실적 제한·평가가 없다고 명시
  "불명확" = 판단 불가
  value에는 인정 기간·분야·금액 기준·발주처 범위(공공/민간)를 원문 그대로 정확히.
• 평가(evaluation): 낙찰자 결정 방법, 기술:가격 비율, 협상적격·적격 통과 기준, 정량·정성 배점 구성(항목별 점수), 가격 평가 특례(예: 일정 비율 미만 투찰 시 감점).
• 규모(scale): 이 사업에서 실제로 수행·납품해야 하는 결과물·작업의 수량만 단위와 함께 원문 숫자 그대로(시간·편·강·차시·회·건·㎡·대 등). 처리 기한·품질 기준·인력은 넣지 않습니다(인력은 staffing). 최대 8개, 중요한 순서.
• 각 항목은 반드시 {"value","quote","source"} 객체로 답합니다. evaluation의 하위 항목도 각각 자기 근거 문장을 quote로 가집니다.
• 대금(payment): 선금·기성(분할)·잔금(준공) 지급 조건. 비율·시기를 원문 그대로.
• 보증·지체(bonds): 계약보증금, 하자보수보증금, 하자담보책임기간, 지체상금률. 법령 준용만 적혀 있으면 그 문구 그대로.

[공고 정보]
공고명: ${bid.title}
공고기관: ${bid.org || "-"} / 수요기관: ${bid.demand_org || "-"}
추정가격: ${bid.price ? bid.price.toLocaleString("ko-KR") + "원" : "미공개"}

${docs.map((d) => `===== [첨부: ${d.name}] =====\n${d.text}`).join("\n\n")}

다음 JSON으로만 답하세요. 각 항목 객체는 {"value": 문자열, "quote": 원문 그대로, "source": 파일명} 형식이며 문서에 없으면 null입니다.
{
  "license": {"relation": "모두|택일|단일|불명확", "items": [{"code": "4자리", "name": "업종명"}], "quote": "", "source": "", "note": "공고문·제안요청서 차이 등 (없으면 빈 문자열)"},
  "directProduction": 항목 (직접생산확인증명서 요구 시 세부품명·번호),
  "companySize": 항목 (중소기업·소상공인 한정, 대기업·중견기업 참여 제한 등),
  "region": 항목 (지역 제한 — 없으면 null),
  "record": {"kind": "자격|배점|자격+배점|제안서 기재|없음|불명확", "points": 숫자 또는 null, "value": "", "quote": "", "source": ""},
  "joint": 항목 (공동수급 허용 여부·구성원 수·최소 지분 등),
  "subcontract": 항목 (하도급 허용 여부),
  "pm": 항목 (사업책임자·PM 자격 요건),
  "onsite": 항목 (상주 근무 요건),
  "staffing": 항목 (발주처가 요구하는 투입 인력 구성·인원·등급),
  "evaluation": {"method": 항목 (낙찰자 결정 방법), "techPrice": 항목 (기술:가격 비율, 예 "90:10"), "passLine": 항목 (협상적격·적격 통과 기준), "quantitative": 항목 (정량평가 배점 구성 — 항목별 점수), "qualitative": 항목 (정성평가 배점 구성 — 항목별 점수), "priceRule": 항목 (가격평가 특례)},
  "budget": 항목 (사업 예산·부가세 포함 여부),
  "period": 항목 (사업·계약 기간),
  "scale": [{"value": "수량·단위를 포함한 과업", "quote": "", "source": ""}],
  "presentation": 항목 (제안 발표 일시·방식·시간·발표자 요건),
  "submission": 항목 (제출 서류 목록),
  "format": 항목 (제안서 분량·용지·파일 형식 제한),
  "payment": {"advance": 항목, "progress": 항목, "final": 항목},
  "bonds": {"contract": 항목, "warranty": 항목, "warrantyPeriod": 항목, "lateFee": 항목}
}`;

/** 인용이 문서에 실제로 있는지 → { name, at } (못 찾으면 null) */
function locate(quote, docs, hint) {
  const q = norm(quote);
  if (q.length < 8) return null;
  const order = [...docs].sort((a, b) => (a.name === hint ? -1 : 0) - (b.name === hint ? -1 : 0));
  for (const d of order) { const at = d.n.indexOf(q); if (at >= 0) return { name: d.name, at, len: q.length }; }
  // 줄바꿈·표 칸 때문에 순서가 조금 흐트러진 경우: 12자 조각의 90% 이상이 같은 문서에 있으면 인정
  const parts = [];
  for (let i = 0; i + 12 <= q.length; i += 8) parts.push(q.slice(i, i + 12));
  if (parts.length < 2) return null;
  for (const d of order) {
    const pos = parts.map((p) => d.n.indexOf(p)).filter((x) => x >= 0);
    if (pos.length / parts.length >= 0.85) return { name: d.name, at: Math.min(...pos), len: q.length };
  }
  return null;
}

/** 값의 숫자가 인용 문장(또는 바로 앞뒤 문맥)에 있는지 — 지어낸 수치 차단
 *  · 수량 단위(회·건·강·시간 등)가 붙은 숫자는 같은 단위로 적혀 있어야 인정
 *  · 금액 단위 환산(천원·만원·백만원·억원)은 같은 수로 인정 */
function numbersOk(value, loc, docs) {
  const d = docs.find((x) => x.name === loc?.name);
  if (!d) return false;
  const win = d.n.slice(Math.max(0, loc.at - 150), loc.at + loc.len + 150);
  const have = new Set((win.match(/\d+(?:\.\d+)?/g) || []).map((x) => Number(x)));
  const v = digits(value).replace(/\s+/g, "");
  const re = /(\d+(?:\.\d+)?)(시간|차시|개월|개소|회|건|강|편|명|년|일|%|점|주|개|대|종|분|식|부|권|곳)?/g;
  let m;
  while ((m = re.exec(v))) {
    const x = Number(m[1]);
    if (x < 2 && Number.isInteger(x)) continue;
    if (m[2]) {
      const pat = new RegExp(`(?<![\\d.])${m[1].replace(".", "\\.")}${m[2] === "%" ? "%" : m[2]}`);
      const alt = m[2] === "%" && new RegExp(`100분의${m[1]}(?![\\d])|${m[1]}퍼센트`).test(win);
      if (!pat.test(win) && !alt) return false;
      continue;
    }
    if (!(have.has(x) || [1e3, 1e4, 1e6, 1e8].some((u) => x % u === 0 && have.has(x / u)))) return false;
  }
  return true;
}

/** 항목 하나 검증 → {value, quote, source} | null */
function check(item, docs, { numbers = true } = {}) {
  if (!item || typeof item !== "object") return null;
  const value = cut(item.value, 260);
  if (!value || /^(null|없음|문서에\s*없음|해당\s*없음)$/.test(value)) return null;
  const loc = locate(item.quote, docs, item.source);
  if (!loc) return null;
  if (numbers && !numbersOk(value, loc, docs)) return null;
  return { value, quote: cut(item.quote, 240), source: loc.name };
}

/** AI 답 전체 검증 */
export function verify(raw, docs) {
  const out = { verified: 0, dropped: [] };
  const take = (k, item, opt) => { const v = check(item, docs, opt); if (v) { out.verified++; return v; } if (item) out.dropped.push(k); return null; };

  // 업종: 코드는 반드시 문서에 있어야 함
  const lic = raw.license;
  if (lic && Array.isArray(lic.items) && lic.items.length) {
    const loc = locate(lic.quote, docs, lic.source);
    const src = loc?.name;
    const items = lic.items.filter((x) => /^\d{4}$/.test(String(x.code || "").trim()) && docs.some((d) => d.n.includes(String(x.code).trim())))
      .map((x) => ({ code: String(x.code).trim(), name: cut(x.name, 60) }));
    if (src && items.length) {
      const relation = ["모두", "택일", "단일", "불명확"].includes(lic.relation) ? (items.length === 1 ? "단일" : lic.relation) : "불명확";
      out.license = { relation, items, quote: cut(lic.quote, 240), source: src, note: cut(lic.note, 160) };
      out.verified++;
    } else out.dropped.push("license");
  }
  for (const k of ["directProduction", "companySize", "region", "joint", "subcontract", "pm", "onsite", "staffing", "budget", "presentation", "submission", "format"]) out[k] = take(k, raw[k]);
  out.period = take("period", raw.period, { numbers: false });

  const rec = raw.record;
  if (rec && rec.kind) {
    const v = check({ value: rec.value || rec.kind, quote: rec.quote, source: rec.source }, docs);
    if (v) {
      const kinds = ["자격", "배점", "자격+배점", "제안서 기재", "없음", "불명확"];
      const loc = locate(rec.quote, docs, rec.source);
      const pts = Number(rec.points) > 0 && Number(rec.points) <= 100 && numbersOk(String(rec.points), loc, docs) ? Number(rec.points) : null;
      out.record = { ...v, kind: kinds.includes(rec.kind) ? rec.kind : "불명확", points: pts };
      out.verified++;
    } else out.dropped.push("record");
  }

  const ev = raw.evaluation || {};
  const evOut = {};
  for (const k of ["method", "techPrice", "passLine", "quantitative", "qualitative", "priceRule"]) {
    let it = ev[k];
    if (typeof it === "string" || typeof it === "number") it = { value: String(it), quote: ev.quote, source: ev.source };
    if (it && typeof it === "object") evOut[k] = take(`evaluation.${k}`, it);
  }
  if (Object.values(evOut).some(Boolean)) out.evaluation = evOut;

  out.scale = (Array.isArray(raw.scale) ? raw.scale : []).map((x) => take("scale", x)).filter(Boolean).slice(0, 8);
  out.payment = {}; for (const k of ["advance", "progress", "final"]) out.payment[k] = take(`payment.${k}`, raw.payment?.[k]);
  out.bonds = {}; for (const k of ["contract", "warranty", "warrantyPeriod", "lateFee"]) out.bonds[k] = take(`bonds.${k}`, raw.bonds?.[k]);
  return out;
}

/** 핵심 검토 항목 도출 (실패 시 null — 기존 방식 결과를 그대로 씀) */
export async function keyReview(files, bid) {
  const docs = prepDocs(files);
  if (!docs.length) return null;
  const raw = await askJson(PROMPT(bid, docs), { maxTokens: 24000, temperature: 0 });
  const kr = verify(raw || {}, docs);
  try { kr.raw = JSON.stringify(raw).slice(0, 30000); } catch {}
  kr.docs = docs.map((d) => d.name);
  kr.at = new Date().toISOString();
  return kr.verified ? kr : null;
}

// ───────── 화면용 변환 ─────────

const REL = { 모두: "모두 보유", 택일: "하나 이상 보유", 단일: "보유", 불명확: "관계 원문 확인" };
export const licenseText = (l) => (l ? `${l.items.map((x) => `${x.name ? `${x.name} ` : ""}(${x.code})`).join(l.relation === "택일" ? " 또는 " : " + ")} · ${REL[l.relation]}` : "");

/** 공고 주요 내용 표: 핵심 검토 항목이 있으면 그것으로, 일정·기본 정보는 나라장터 공고 정보로 */
export function factsFromReview(kr, bid = {}, meta = {}, old = []) {
  const dt = (v) => { const m = String(v || "").match(/(\d{4})-(\d{2})-(\d{2})\s*(\d{2}):(\d{2})/); return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}. ${m[4]}:${m[5]}` : ""; };
  const api = (label, value) => ({ label, value: value || NONE, source: value ? "나라장터 공고 정보" : "", missing: !value });
  const row = (label, v) => (v ? { label, value: v.value, quote: v.quote, source: v.source } : { label, value: NONE, missing: true });
  const ev = kr.evaluation;
  const methodApi = [meta.cntrctCnclsMthdNm, meta.sucsfbidMthdNm].filter(Boolean).join(" · ");
  const evRows = [
    ev?.method ? row("낙찰자 결정 방법", ev.method) : api("낙찰자 결정 방법", methodApi),
    ev?.techPrice && row("기술 : 가격", ev.techPrice),
    ev?.passLine && row("적격 기준", ev.passLine),
    ev?.quantitative && row("정량 평가", ev.quantitative),
    ev?.qualitative && row("정성 평가", ev.qualitative),
    ev?.priceRule && row("가격 평가 특례", ev.priceRule),
  ].filter(Boolean);

  const lic = kr.license;
  const rec = kr.record;
  const recText = rec ? `${rec.kind}${rec.points ? ` (${rec.points}점)` : ""} · ${rec.value}` : "";
  const sched = (old.find((g) => g.group === "일정")?.rows || []).filter((r) => r.source === "나라장터 공고 정보");
  // 공동수급·하도급은 허용 여부만 보는 단순 조항이라, 검증 값이 없으면 기존 원문 추출을 씀
  const oldRow = (label) => (old.flatMap((g) => g.rows).find((r) => r.label === label && !r.missing) || { label, value: NONE, missing: true });
  return [
    { group: "기본 정보", rows: [
      api("사업명", bid.title),
      api("공고기관 / 수요기관", [bid.org, bid.demand_org && bid.demand_org !== bid.org ? bid.demand_org : ""].filter(Boolean).join(" / ")),
      api("추정가격 (부가세 제외)", won(bid.price)),
      row("사업 예산 (문서)", kr.budget),
      row("사업 기간", kr.period),
    ] },
    { group: "평가 방식", rows: evRows },
    { group: "참가 자격", rows: [
      lic ? { label: "업종 등록", value: licenseText(lic) + (lic.note ? ` · ${lic.note}` : ""), quote: lic.quote, source: lic.source } : row("업종 등록", null),
      ...(kr.directProduction ? [row("직접생산확인", kr.directProduction)] : []),
      ...(kr.companySize ? [row("기업 규모 제한", kr.companySize)] : []),
      kr.region ? row("지역 제한", kr.region) : api("지역 제한", bid.region && bid.region !== "전국" ? bid.region : bid.region === "전국" ? "제한 없음(전국)" : ""),
      rec ? { label: "실적", value: recText, quote: rec.quote, source: rec.source } : row("실적", null),
      kr.joint ? row("공동수급", kr.joint) : oldRow("공동수급"),
      kr.subcontract ? row("하도급", kr.subcontract) : oldRow("하도급"),
      ...(kr.pm ? [row("PM(사업책임자) 요건", kr.pm)] : []),
    ] },
    { group: "과업 규모", rows: kr.scale.length
      ? [...kr.scale.map((s, i) => ({ label: i === 0 ? "수행 수량" : "", value: s.value, quote: s.quote, source: s.source })), ...(kr.onsite ? [row("상주", kr.onsite)] : [])]
      : [row("수행 수량", null), ...(kr.onsite ? [row("상주", kr.onsite)] : [])] },
    ...(kr.staffing ? [{ group: "투입 인력", rows: [row("요구 인력", kr.staffing)] }] : []),
    { group: "일정", rows: [...sched, row("제안 발표", kr.presentation)] },
    { group: "계약 · 대금", rows: [
      row("선금", kr.payment.advance), row("기성(분할 지급)", kr.payment.progress), row("잔금(준공)", kr.payment.final),
      row("계약보증금", kr.bonds.contract), row("하자보수보증금", kr.bonds.warranty), row("하자담보 기간", kr.bonds.warrantyPeriod), row("지체상금", kr.bonds.lateFee),
    ] },
    { group: "제출", rows: [row("제출 서류", kr.submission), row("제안서 작성 형식", kr.format)] },
  ];
}

/** 입찰 가능 여부 체크 항목을 검증된 값으로 교체 */
export function gateFromReview(kr, gate = []) {
  // 검증 값이 있는 항목만 교체하고, 없는 항목은 기존 판단을 유지 (단, 실적은 검증 결과가 자격이 아니면 제외)
  const replaced = { "g-license": kr.license, "g-direct": kr.directProduction, "g-sme": kr.companySize, "g-region": kr.region, "g-perf": kr.record, "g-jv": kr.joint, "g-pm": kr.pm };
  const keep = gate.filter((g) => !replaced[g.id]);
  const out = [];
  if (kr.license) out.push({ id: "g-license", item: "입찰참가자격(업종 등록)을 갖고 있는가", detail: `${licenseText(kr.license)} (입찰마감 전일까지 등록)`, evidence: [kr.license.quote] });
  if (kr.directProduction) out.push({ id: "g-direct", item: "직접생산확인증명서를 보유하고 있는가", detail: cut(kr.directProduction.value, 120), evidence: [kr.directProduction.quote] });
  if (kr.companySize) out.push({ id: "g-sme", item: "기업 규모 제한에 해당하는가", detail: cut(kr.companySize.value, 120), evidence: [kr.companySize.quote] });
  if (kr.region) out.push({ id: "g-region", item: "참가 가능 지역에 해당하는가", detail: cut(kr.region.value, 120), evidence: [kr.region.quote] });
  if (kr.record && /자격/.test(kr.record.kind)) out.push({ id: "g-perf", item: "참가 자격 실적을 충족하는가", detail: cut(kr.record.value, 140), evidence: [kr.record.quote], level: "block" });
  if (kr.joint) out.push({ id: "g-jv", item: /불허|불가|허용하지|금지/.test(kr.joint.value) ? "단독으로 수행 가능한가 (공동수급 불허)" : "공동수급 필요 시 파트너가 있는가", detail: cut(kr.joint.value, 120), evidence: [kr.joint.quote] });
  if (kr.pm) out.push({ id: "g-pm", item: "PM(사업책임자) 요건을 충족하는 인력이 있는가", detail: cut(kr.pm.value, 120), evidence: [kr.pm.quote] });
  // 기존 항목 중 설명회·신용등급·준비 기간은 유지 (마감까지 일수는 맨 뒤)
  return [...out, ...keep.filter((g) => g.id !== "g-time"), ...keep.filter((g) => g.id === "g-time")];
}

/** 유사용역 실적 카드 */
export function recordFromReview(kr, old) {
  const r = kr.record;
  if (!r) return old || null;
  const kind = { 자격: "자격", 배점: "배점", "자격+배점": "둘다", "제안서 기재": "제안서", 없음: "없음", 불명확: "미상" }[r.kind] || "미상";
  const note = kind === "자격" ? "참가 자격 조건입니다. 충족하지 못하면 입찰할 수 없습니다."
    : kind === "둘다" ? `참가 자격 조건이며 기술평가에도 반영됩니다${r.points ? ` (${r.points}점)` : ""}.`
    : kind === "배점" ? `참가 자격 제한은 없고 기술평가 점수로 반영됩니다${r.points ? ` (${r.points}점)` : ""}.`
    : kind === "제안서" ? "제안서에 실적을 기재하도록 되어 있으며 별도 자격·배점은 없습니다."
    : kind === "없음" ? "실적으로 참가를 제한하지 않는다고 문서에 명시되어 있습니다."
    : "자격인지 배점인지 문서에서 명확하지 않습니다. 원문을 확인하세요.";
  return {
    kind, note,
    gate: { ok: !/자격/.test(r.kind), text: note },
    rows: [{ label: "조건", value: r.value, quote: r.quote, source: r.source }],
    lines: old?.lines || [],
  };
}
