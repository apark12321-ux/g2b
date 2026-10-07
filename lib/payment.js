// 대금 지급 조건(선금·기성·잔금·보증금·지체상금)을 문서에서 찾음 → 운영 이슈(자금 부담) 판단용
const cut = (x, n = 110) => (x.length > n ? x.slice(0, n - 1) + "…" : x);

export function findPayment(docText) {
  const lines = String(docText || "")
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 6 && l.length <= 300 && !/(양도인|양수인|양도비용|저작재산권\s*양도)/.test(l)); // 저작권 양도계약서 서식은 제외
  const find = (re, extra) => lines.find((l) => re.test(l) && (!extra || extra.test(l)));
  // 키워드 '뒤에' 나오는 첫 % (한 줄에 여러 항목이 있을 때)
  const pct = (l, key) => {
    if (!l) return null;
    const i = key ? l.search(key) : 0;
    const m = l.slice(Math.max(0, i)).match(/(\d{1,2}(?:\.\d+)?)\s*%/);
    return m ? Number(m[1]) : null;
  };
  const out = { found: [] };

  // 선금
  const noAdv = find(/(선금|선급금)[^.]{0,30}(지급하지\s*않|미지급|불가|없음)/);
  const adv = find(/(선금|선급금|선지급)/, /(지급|청구|%|비율|이내)/);
  if (noAdv) out.advance = { has: false, text: cut(noAdv) };
  else if (adv) out.advance = { has: true, pct: pct(adv, /(선금|선급금|선지급|계약금액)/), text: cut(adv) };

  // 기성(중간 지급)
  const prog = find(/(기성\s*(?:금|대가|부분|검사)?|분할\s*(?:지급|납품)|중간\s*(?:정산|지급)|단계별\s*(?:지급|대가)|회차별\s*지급)/);
  if (prog) out.progress = { text: cut(prog) };

  // 잔금·지급 시기
  const fin = find(/(준공|완료|납품|최종\s*검수|검사|검수)[^.]{0,25}(후|완료\s*후|합격)[^.]{0,40}(지급|정산|청구)/) || find(/대금[^.]{0,30}(지급|청구)/, /(일\s*이내|검수|검사|완료|준공)/);
  if (fin) {
    const d = fin.match(/(\d{1,2})\s*일\s*(?:이내|안에)/);
    out.final = { text: cut(fin), days: d ? Number(d[1]) : null };
  }

  // 보증금·지체상금
  const cg = find(/계약\s*보증(?:금)?/, /%/);
  if (cg) out.contractBond = { pct: pct(cg, /계약\s*보증/), text: cut(cg) };
  const wg = find(/하자\s*(?:보수\s*)?보증(?:금)?/, /%/);
  if (wg) out.warrantyBond = { pct: pct(wg, /하자\s*(?:보수\s*)?보증/), text: cut(wg) };
  const late = find(/지체\s*상금/);
  if (late) {
    const tail = late.slice(late.search(/지체\s*상금/));
    const m = tail.match(/(\d+(?:\.\d+)?)\s*\/\s*1,?000/) || tail.match(/(\d+(?:\.\d+)?)\s*%/);
    out.lateFee = { rate: m ? m[0] : null, text: cut(late) };
  }
  const warr = find(/하자\s*(?:보수|담보)\s*(?:책임\s*)?기간/, /(\d+)\s*(년|개월)/);
  if (warr) { const m = warr.slice(warr.search(/하자\s*(?:보수|담보)/)).match(/(\d+)\s*(년|개월)/) || warr.match(/(\d+)\s*(년|개월)/); out.warrantyPeriod = { text: cut(warr), months: m[2] === "년" ? Number(m[1]) * 12 : Number(m[1]) }; }

  // 지급 방식 정리
  out.method = out.advance?.has ? `선금 ${out.advance.pct ? out.advance.pct + "%" : "지급"} + 잔금` : out.progress ? "기성(중간) + 잔금" : out.final ? "완료 후 일괄 지급(후불)" : null;
  out.documented = !!(out.advance || out.progress || out.final);
  return out;
}

/** 자금 선투입: 대금을 받기 전 회사가 먼저 쓰는 돈 */
export function cashNeed(payment, est) {
  if (!est || !est.supply) return null;
  const p = payment || {};
  const months = est.months || 3;
  const cost = est.cost.total;
  const monthly = cost / months;
  const advPct = p.advance?.has ? (p.advance.pct || 0) / 100 : 0;
  const adv = est.supply * 1.1 * advPct; // 선금은 계약금액(부가세 포함) 기준
  const days = p.final?.days ?? 14; // 검수 후 지급까지 (미기재 시 14일로 가정)
  const method = p.method || "완료 후 일괄 지급(후불, 통상)";
  // 기성이 있으면 중간에 절반쯤 회수된다고 봄
  const peak = Math.max(0, (p.progress ? cost * 0.55 : cost) - adv);
  return { method, assumed: !p.method, adv, advPct, peak, monthly, waitMonths: months + days / 30, days };
}
