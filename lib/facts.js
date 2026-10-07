// 핵심 사실: 문서(제안요청서·공고문 등)와 나라장터 공고 정보에서 '그대로 확인되는 것'만 모음
// 추정·가정은 넣지 않음. 못 찾으면 "문서에서 확인되지 않음"
import { dropToc } from "./basic-extract";

const NONE = "문서에서 확인되지 않음";
const cut = (x, n = 160) => { const t = String(x || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const won = (n) => (n ? `${Number(n).toLocaleString("ko-KR")}원` : "");
const dt = (v) => {
  const m = String(v || "").match(/(\d{4})-(\d{2})-(\d{2})\s*(\d{2}):(\d{2})/);
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}. ${m[4]}:${m[5]}` : "";
};

/**
 * files: [{ name, text }] — 읽은 문서들 (제안요청서 우선)
 * → groups: [{ group, rows: [{ label, value, quote, source, missing }] }]
 */
export function buildFacts(files, bid = {}, meta = {}, extra = {}) {
  const docs = (files || []).map((f) => ({
    name: f.name,
    lines: dropToc(String(f.text || "")).split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 4 && l.length <= 400),
  })).sort((a, b) => (/제안\s*요청/.test(b.name) ? 1 : 0) - (/제안\s*요청/.test(a.name) ? 1 : 0));
  // 문서 전체에서 조건에 맞는 첫 줄 (+출처 파일)
  const hit = (re, not) => {
    for (const d of docs) for (const l of d.lines) if (re.test(l) && (!not || !not.test(l))) return { quote: cut(l, 220), source: d.name, line: l };
    return null;
  };
  const hits = (re, n = 6, not) => {
    const out = [];
    for (const d of docs) for (const l of d.lines) if (re.test(l) && (!not || !not.test(l)) && !out.some((o) => o.line === l)) { out.push({ quote: cut(l, 200), source: d.name, line: l }); if (out.length >= n) return out; }
    return out;
  };
  const after = (h, re) => { if (!h) return ""; const m = h.line.match(re); return m ? cut(m[1], 160) : cut(h.line, 160); };
  const row = (label, h, value) => (h ? { label, value: value || cut(h.line, 160), quote: h.quote, source: h.source } : { label, value: NONE, missing: true });
  const api = (label, value) => ({ label, value: value || NONE, source: value ? "나라장터 공고 정보" : "", missing: !value });
  const LAW = /(법률|시행령|시행규칙|조달청\s*지침|계약예규)/;

  const groups = [];

  // ── 기본 정보
  const budget = hit(/(사업\s*예산|배정\s*예산|소요\s*예산|추정\s*금액|사업비)\s*[:：]?\s*[\d,금]/);
  const period = hit(/(사업|계약|용역|과업|수행)\s*기간\s*[:：]/) || hit(/(착수일|계약일|계약\s*체결일)\s*(?:로|으로)?부터\s*[^\n]{2,40}(까지|이내|간)/);
  groups.push({ group: "기본 정보", rows: [
    api("사업명", bid.title),
    api("공고기관 / 수요기관", [bid.org, bid.demand_org && bid.demand_org !== bid.org ? bid.demand_org : ""].filter(Boolean).join(" / ")),
    api("추정가격 (부가세 제외)", won(bid.price)),
    row("사업 예산 (문서)", budget, after(budget, /(?:사업\s*예산|배정\s*예산|소요\s*예산|추정\s*금액|사업비)\s*[:：]?\s*(.+)/)),
    row("사업 기간", period, after(period, /기간\s*[:：]\s*(.+)/)),
    api("계약 방법", [meta.cntrctCnclsMthdNm, meta.sucsfbidMthdNm].filter(Boolean).join(" · ")),
  ] });

  // ── 일정 (나라장터)
  const sched = [
    api("입찰참가자격 등록 마감", dt(meta.bidQlfctRgstDt)),
    api("입찰(제안서) 마감", dt(meta.bidClseDt) || (bid.close_at ? new Date(bid.close_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "")),
    api("개찰", dt(meta.opengDt)),
  ];
  if (meta.dcmtgOprtnDt) sched.push(api("설명회", `${dt(meta.dcmtgOprtnDt)}${meta.dcmtgOprtnPlce ? ` · ${meta.dcmtgOprtnPlce}` : ""}`));
  const pres = hit(/(발표|프레젠테이션|PT)[^.\n]{0,30}(일시|일자|예정|순서|시간)/);
  sched.push(row("제안 발표 (방식·일정)", pres));
  groups.push({ group: "일정", rows: sched });

  // ── 참가 자격
  const codes = hits(/업종\s*코드\s*[:：]?\s*\d{4}/, 6, /직접\s*생산/);
  const perf = hit(/(수행\s*실적|납품\s*실적|실적\s*제한)[^.]{0,80}(이상|보유|이내|있는|업체)/, LAW) || hit(/최근\s*\d+\s*년\s*이내[^.]{0,60}실적/);
  const jv = hit(/공동\s*(?:수급|계약|도급)[^.]{0,15}(불허|불가|허용|가능|금지)/, /(인력|구성원을?\s*변경|부정당)/);
  const sub = hit(/하도급[^.]{0,30}(금지|불가|제한|승인|허용)/);
  const pm = hit(/(사업\s*관리자|사업\s*책임자|PM)[^.]{0,80}(경력|자격|재직|발표)/);
  const presenter = hit(/(사업\s*관리자|사업\s*책임자|PM|대표)[^.]{0,40}발표\s*(?:하여야|해야|한다|함)|발표자는?[^.]{0,30}(한정|직접|대리)/);
  groups.push({ group: "참가 자격", rows: [
    codes.length ? { label: "업종 등록", value: codes.map((c) => cut(c.line.replace(/^[\d)\.\s]+/, ""), 60)).join(" / "), quote: codes[0].quote, source: codes[0].source } : row("업종 등록", null),
    api("참가 가능 지역", bid.region && bid.region !== "전국" ? bid.region : bid.region === "전국" ? "제한 없음(전국)" : ""),
    row("실적 요건", perf),
    row("공동수급", jv),
    row("하도급", sub),
    row("PM(사업책임자) 요건", pm),
    row("제안 발표자", presenter),
  ] });

  // ── 과업 내용
  const scope = hit(/(사업\s*내용|과업\s*내용|개발\s*내용|사업\s*규모|개발\s*규모)\s*[:：]/);
  const qty = hits(/(\(분량\)|\d+\s*(?:차시|편|강좌|주차|종)\b|\d+\s*분\s*(?:이상|이내|내외))/, 5, LAW);
  // 요구사항은 '무엇이 적혀 있는지'만 (비용 해석 없이 중립적인 이름으로)
  const TOPIC = { studio: "스튜디오", advisor: "자문·전문가", talent: "출연·섭외", voice: "내레이션", translate: "번역·외국어", access: "수어·화면해설·자막", license: "저작권·라이선스", special: "특수 촬영", gear: "촬영 규격", travel: "현장 촬영", review: "내용심사·검수", meeting: "보고·시연", print: "인쇄·매체", server: "개발 사이트·서버", bond: "보증", warranty: "하자보수", privacy: "비식별 처리", quiz: "평가문항", material: "교재·학습자료", storyboard: "구성안·스토리보드" };
  const reqs = (extra.costItems?.items || []).map((x) => ({ label: TOPIC[x.key] || x.label, value: x.evidence, quote: x.evidence, source: "문서" }));
  const deliv = hits(/(납품물|산출물|최종\s*결과물|납품\s*목록|제출물)\s*[:：]?/, 4, LAW);
  groups.push({ group: "과업 내용", rows: [
    row("사업 내용·규모", scope, after(scope, /[:：]\s*(.+)/)),
    qty.length ? { label: "분량", value: qty.map((q) => cut(q.line, 80)).join(" / "), quote: qty[0].quote, source: qty[0].source } : row("분량", null),
    deliv.length ? { label: "산출물·납품 관련", value: deliv.map((q) => cut(q.line, 80)).join(" / "), quote: deliv[0].quote, source: deliv[0].source } : row("납품물", null),
    ...reqs.slice(0, 10).map((r) => ({ label: `요구사항 · ${r.label}`, value: cut(r.value, 140), quote: r.quote, source: r.source })),
  ] });

  // ── 계약·대금
  const p = extra.payment || {};
  const f = (label, o) => (o ? { label, value: cut(o.text, 140), quote: o.text, source: "문서" } : { label, value: NONE, missing: true });
  groups.push({ group: "계약 · 대금", rows: [
    f("선금", p.advance), f("기성(중간 지급)", p.progress), f("잔금 지급", p.final),
    f("계약보증금", p.contractBond), f("하자보수보증금", p.warrantyBond), f("하자담보 기간", p.warrantyPeriod), f("지체상금", p.lateFee),
  ] });

  // ── 제출
  const docIdx = (() => { for (const d of docs) { const i = d.lines.findIndex((l) => /(아래|다음)\s*서류를?\s*(반드시\s*)?제출|제출\s*서류|구비\s*서류/.test(l)); if (i >= 0) return { d, i }; } return null; })();
  const subDocs = [];
  if (docIdx) for (let j = docIdx.i + 1; j < docIdx.d.lines.length && subDocs.length < 12; j++) {
    const l = docIdx.d.lines[j];
    if (/^(\d{1,2}\)|\d{1,2}\.|[①-⑳]|-|◦|○)\s*/.test(l)) subDocs.push(l.replace(/^(\d{1,2}\)|\d{1,2}\.|[①-⑳]|-|◦|○)\s*/, ""));
    else if (subDocs.length) break;
  }
  const pages = hit(/(\d{1,3})\s*(?:쪽|페이지|매)\s*(?:이내|이하|내외)/);
  const fmt = hit(/(A4|글자\s*크기|폰트|PDF|HWP)[^.]{0,40}(작성|제출|형식)/);
  groups.push({ group: "제출", rows: [
    subDocs.length ? { label: `제출 서류 (${subDocs.length}종)`, value: subDocs.map((x) => cut(x, 60)).join(" / "), quote: docIdx.d.lines[docIdx.i], source: docIdx.d.name } : row("제출 서류", null),
    row("제안서 분량", pages), row("작성·제출 형식", fmt),
  ] });

  return groups;
}
