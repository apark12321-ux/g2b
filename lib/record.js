// 유사용역 수행실적 요건 — 입찰 가능 여부를 가르는 조건이라 따로 자세히 뜯어본다.
// 문서에 적힌 것만 쓰고, 못 찾은 항목은 '문서에서 확인되지 않음'으로 남긴다.

const cut = (x, n = 200) => { const t = String(x || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;

// 억·천만 단위를 원으로
function moneyIn(line) {
  const t = String(line).replace(/,/g, "");
  let m = t.match(/(\d+(?:\.\d+)?)\s*억/);
  if (m) return Math.round(Number(m[1]) * 1e8);
  m = t.match(/(\d+(?:\.\d+)?)\s*천만/);
  if (m) return Math.round(Number(m[1]) * 1e7);
  m = t.match(/(\d{7,})\s*원/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * files: [{ name, text }] — 읽은 문서
 * → null | {
 *     required,            // 참가 자격인가(못 채우면 입찰 불가) / 평가 점수인가
 *     kind: "자격"|"배점"|"둘다"|"미상",
 *     rows: [{ label, value, quote, source }],
 *     gate: { ok:null, text } ,          // 입찰 가능 여부에 넘길 한 줄
 *     note,                               // 한 줄 요약
 *   }
 */
export function recordReq(files, bid = {}) {
  const docs = (files || [])
    .map((f) => ({
      name: f.name,
      lines: String(f.text || "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 5 && l.length <= 400),
    }))
    .sort((a, b) => (/입찰\s*공고|공고문/.test(b.name) ? 1 : 0) - (/입찰\s*공고|공고문/.test(a.name) ? 1 : 0));
  if (!docs.length) return null;

  const PERF = /(수행\s*실적|납품\s*실적|용역\s*실적|제작\s*실적|사업\s*실적|유사\s*실적|동종\s*실적|실적\s*증명|실적\s*기준|실적\s*요건|실적\s*제한|유사\s*용역|동종\s*용역)/;
  const all = [];
  for (const d of docs) for (const l of d.lines) if (PERF.test(l) && !all.some((x) => x.line === l)) all.push({ line: l, source: d.name });
  if (!all.length) return null;

  const pick = (re, not) => all.find((x) => re.test(x.line) && (!not || !not.test(x.line))) || null;
  const rows = [];
  const add = (label, h, value) => { if (h) rows.push({ label, value: value || cut(h.line, 170), quote: cut(h.line, 260), source: h.source }); };

  // ① 인정 기간 — 최근 몇 년 이내 실적인가
  const period = pick(/최근\s*\d+\s*(년|개월)/);
  const pm = period && period.line.match(/최근\s*(\d+)\s*(년|개월)/);
  add("인정 기간", period, pm ? `최근 ${pm[1]}${pm[2]} 이내 실적만 인정` : null);

  // ② 금액 기준 — 단일 계약인지 합산인지가 갈린다
  const single = pick(/(단일|1건|한\s*건|동일\s*계약)[^.]{0,40}(이상|실적)/);
  const sumUp = pick(/(합산|누계|합계|총액)[^.]{0,40}(이상|실적)/);
  const amtLine = pick(/실적[^.]{0,60}(억|천만|\d{7,}\s*원)[^.]{0,20}이상/) || pick(/(억|천만|\d{7,}\s*원)[^.]{0,30}이상[^.]{0,40}실적/);
  const amt = amtLine ? moneyIn(amtLine.line) : null;
  if (single) add("금액 기준", single, `단일 계약 기준${amt ? ` · ${won(amt)} 이상` : ""} — 여러 건을 더해서 채울 수 없음`);
  else if (sumUp) add("금액 기준", sumUp, `합산 인정${amt ? ` · 총 ${won(amt)} 이상` : ""}`);
  else if (amtLine) add("금액 기준", amtLine, amt ? `${won(amt)} 이상` : null);

  // ③ 건수 기준
  const cnt = pick(/실적[^.]{0,40}\d+\s*건\s*이상/) || pick(/\d+\s*건\s*이상[^.]{0,30}실적/);
  const cm = cnt && cnt.line.match(/(\d+)\s*건\s*이상/);
  add("건수 기준", cnt, cm ? `${cm[1]}건 이상` : null);

  // ④ 인정 범위 — 어떤 용역을 '유사'로 보는가 (가장 중요한데 가장 두루뭉술하게 적힘)
  const SCORE = /(배점|\d+\s*점|정량\s*평가)/;
  const WORK = /(영상|동영상|이러닝|e-?러닝|콘텐츠|교육|강의|촬영|편집|제작|개발)/;
  const scope =
    pick(/(동종|유사)[^.]{0,80}(용역|사업|실적)/, SCORE) ||            // 배점 설명 줄은 피해서
    pick(new RegExp(`실적[^.]{0,60}${WORK.source}`), SCORE) ||
    pick(new RegExp(`${WORK.source}[^.]{0,40}(용역|사업)[^.]{0,30}실적`), SCORE) ||
    pick(/(동종|유사)[^.]{0,80}(용역|사업|실적)/) ||
    pick(/실적[^.]{0,20}(범위|인정)/);
  add("인정 범위", scope);

  // ⑤ 발주처 제한 — 공공 실적만 쳐주는 경우
  const org = pick(/(국가기관|지방자치단체|공공기관|공기업|정부기관|관공서)[^.]{0,50}(실적|계약|발주)/);
  add("발주처 제한", org, org ? "공공기관 발주 실적으로 한정될 수 있음 — 민간 실적 인정 여부 확인" : null);

  // ⑥ 공동수급·하도급 실적 인정
  const jv = pick(/(공동수급|구성원|컨소시엄)[^.]{0,50}실적/) || pick(/실적[^.]{0,30}(지분율|출자\s*비율)/);
  add("공동수급 실적", jv, jv ? "구성원 실적 합산·지분율 반영 조건 — 협정 전에 확인" : null);
  const sub = pick(/하도급[^.]{0,40}실적/);
  add("하도급 실적", sub);

  // ⑦ 증빙 서류
  const proof = pick(/실적\s*증명(서|원)|계약서\s*사본|세금계산서/);
  add("증빙 서류", proof);

  // ⑧ 자격 요건인가 평가 점수인가 — 실무에서 제일 갈리는 지점
  const gateLine = pick(/실적[^.]{0,60}(없는\s*경우|미달|미충족|참가\s*불가|자격\s*없|제한한다|제한함|에\s*한함|한정)/)
    || pick(/(참가\s*자격|입찰\s*참가)[^.]{0,80}실적/);
  const scoreLine = pick(/실적[^.]{0,50}(배점|점수|평가\s*항목|정량|\d+\s*점)/) || pick(/(배점|정량\s*평가)[^.]{0,50}실적/);
  const sm = scoreLine && scoreLine.line.match(/(\d+(?:\.\d+)?)\s*점/);
  add("자격 제한", gateLine, gateLine ? "실적이 참가 자격으로 걸려 있음 — 못 채우면 입찰 자체가 불가" : null);
  add("평가 배점", scoreLine, sm ? `정량 평가에 ${sm[1]}점 반영` : null);

  const kind = gateLine && scoreLine ? "둘다" : gateLine ? "자격" : scoreLine ? "배점" : "미상";
  const note =
    kind === "자격" ? "실적이 참가 자격입니다. 충족하지 못하면 입찰에 들어갈 수 없습니다."
    : kind === "둘다" ? "실적이 참가 자격이면서 평가 점수에도 반영됩니다."
    : kind === "배점" ? "참가 자격은 아니고 평가 점수에 반영됩니다. 실적이 적으면 그만큼 감점입니다."
    : "실적 관련 문구는 있으나 자격 제한인지 배점인지 문서에서 분명하지 않습니다. 발주처에 확인하세요.";

  if (!rows.length) return null;
  return {
    kind, note, required: kind === "자격" || kind === "둘다",
    rows,
    gate: {
      ok: null,
      text: kind === "자격" || kind === "둘다"
        ? `유사용역 실적 요건을 충족하는가 — ${rows.find((r) => r.label === "금액 기준")?.value || "문서의 실적 조건"}`
        : "유사용역 실적 (평가 점수) — 제출 가능한 실적증명서 확인",
    },
  };
}
