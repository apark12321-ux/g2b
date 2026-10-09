// 공동수급(공동도급) 분석 — 수급업체(참여사) 입장에서 본다
// 공동사업이 틀어지는 지점: 마진 배분, 과업 경계, 역할, 지분 비중.
// 여기서 삐끗하면 사업 자체가 엎어지므로, 협정 전에 문서로 못 박을 것을 뽑아 준다.

const cut = (x, n = 170) => { const t = String(x || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const JV = /공동\s*(?:수급|도급|계약|이행|분담)/;
const NOISE = /(공동\s*활용|공동\s*저작|공동\s*이용|공동\s*연구|시\s*·\s*도|교육청)/;

/**
 * docText: 문서 전체, bid·a: 공고·분석 결과
 * → null (공동수급 조항 없음) 또는 { applies, mode, items, checks, risks, note }
 */
export function jointReview(docText, bid = {}, a = {}) {
  const lines = String(docText || "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 6 && l.length <= 400);
  const jvLines = lines.filter((l) => JV.test(l) && !NOISE.test(l));
  const hit = (re, pool = lines) => pool.find((l) => re.test(l)) || null;

  const banned = jvLines.find((l) => /공동\s*(?:수급|도급|계약)[^.]{0,20}(불허|불가|금지|허용하지\s*않)/.test(l) && !/(인력|이외|투입)/.test(l));
  if (banned) {
    return { applies: false, mode: "불허", items: [{ label: "공동수급", value: "불허 — 단독 참여만 가능", quote: cut(banned) }],
      checks: [], risks: [], note: "공동수급이 막혀 있어 단독으로 수행할 수 있는지가 먼저입니다." };
  }
  if (!jvLines.length) return null;

  const items = [], checks = [], risks = [];
  const add = (label, line, value, note) => items.push({ label, value: value || (line ? cut(line, 120) : "문서에 없음"), quote: line ? cut(line) : null, note, missing: !line });

  // ① 이행 방식 — 수급업체에게 가장 중요. 공동이행이면 상대 잘못도 같이 뒤집어쓴다
  const bunam = jvLines.find((l) => /분담\s*이행/.test(l));
  const gongdong = jvLines.find((l) => /공동\s*이행/.test(l));
  const jugye = jvLines.find((l) => /주\s*계약자/.test(l));
  let mode = "미기재";
  if (bunam && gongdong) mode = "공동이행·분담이행 모두 가능";
  else if (bunam) mode = "분담이행";
  else if (gongdong) mode = "공동이행";
  else if (jugye) mode = "주계약자 관리방식";
  add("이행 방식", bunam || gongdong || jugye, mode,
    mode === "분담이행" ? "맡은 부분만 책임집니다. 과업 경계를 협정서에 적어 두면 분쟁이 줄어듭니다."
    : mode === "공동이행" ? "지분율대로 전체를 연대 책임집니다. 상대가 펑크 내면 우리가 메워야 합니다."
    : mode === "공동이행·분담이행 모두 가능" ? "고를 수 있다면 분담이행이 유리합니다 — 맡은 몫만 책임집니다."
    : "방식이 안 적혀 있습니다. 발주처에 확인하고, 가능하면 분담이행으로 가세요.");
  if (mode === "공동이행") risks.push({ level: "주의", item: "공동이행 방식 — 상대 구성원 잘못도 연대 책임", detail: cut(gongdong, 120), core: false });
  if (mode === "미기재") checks.push("이행 방식(공동이행/분담이행) 발주처 확인 — 분담이행이면 우리 몫만 책임");

  // ② 지분율 — 우리 업무 비중과 맞는지가 신경전의 핵심
  const share = jvLines.find((l) => /(출자\s*비율|지분율?|구성\s*비율)/.test(l) && /\d+\s*%/.test(l))
    || hit(/(최소\s*(?:출자|지분|구성)\s*비율|구성원[^.]{0,20}\d+\s*%\s*이상)/);
  const m = share && share.match(/(\d{1,2})\s*%\s*이상/);
  const minPct = m ? Number(m[1]) : null;
  const ourPct = a.workMix?.video ?? null;
  add("지분율(출자비율)", share, minPct ? `구성원 최소 ${minPct}% 이상` : share ? cut(share, 110) : null,
    ourPct !== null
      ? `문서 기준 우리 담당 업무는 약 ${ourPct}%(영상 제작)입니다. 지분율을 실제 투입 비중에 맞추지 않으면 일은 더 하고 돈은 덜 받습니다.`
      : "지분율은 받을 돈의 비율입니다. 실제 투입 비중과 어긋나지 않게 맞추세요.");
  checks.push(ourPct !== null
    ? `지분율을 실제 투입 비중에 맞추기 — 우리 담당 ${ourPct}% 기준으로 협상`
    : "지분율을 실제 투입 비중에 맞추기");

  // ③ 대금 수령 — 대표사 일괄이면 떼일 위험
  const pay = jvLines.find((l) => /(대가|대금|기성|선금)[^.]{0,30}(지급|청구|분할|직접)/.test(l))
    || hit(/(구성원\s*별|각\s*구성원)[^.]{0,25}(직접\s*)?지급/);
  const direct = pay && /(구성원\s*별|각\s*구성원|개별)[^.]{0,25}지급/.test(pay);
  add("대금 수령", pay, pay ? (direct ? "구성원별 직접 지급" : cut(pay, 110)) : null,
    direct ? "발주처가 우리에게 직접 넣어 줍니다. 대표사를 거치지 않아 안전합니다."
      : "대표사가 일괄 수령해 나눠 주는 구조면, 정산 지연·누락 위험이 있습니다. 구성원별 직접 지급으로 요청하세요.");
  if (!direct) { risks.push({ level: "주의", item: "대금이 대표사를 거칠 수 있음 — 구성원별 직접 지급 확인 필요", detail: pay ? cut(pay, 120) : "문서에 지급 주체가 명시되지 않음", core: false });
    checks.push("대금을 구성원별로 직접 받도록 협정서에 명시"); }

  // ④ 구성원 변경 — 낙찰 후엔 못 바꾸니 들어가기 전에 다 정해야 한다
  const fix = jvLines.find((l) => /구성원[^.]{0,25}(변경할\s*수\s*없|변경\s*금지|변경\s*불가)/.test(l));
  add("구성원 변경", fix, fix ? "낙찰 후 변경 불가" : null,
    fix ? "협정서에 서명하기 전에 과업 경계·지분·역할을 모두 못 박아야 합니다. 나중에 못 바꿉니다."
      : "보통 낙찰 후에는 바꾸지 못합니다. 서명 전에 확정하세요.");
  checks.push("협정서 서명 전에 과업 경계·지분·역할 문서로 확정");

  // ⑤ 연대 책임 — 하자·지체상금을 남의 몫까지 떠안는지
  const joint = jvLines.find((l) => /연대|공동\s*책임/.test(l)) || hit(/(하자|지체\s*상금)[^.]{0,30}연대/);
  add("연대 책임", joint, joint ? cut(joint, 110) : null,
    joint ? "상대 구성원의 지연·하자까지 책임질 수 있습니다. 분담이행이면 범위가 내 몫으로 줄어듭니다."
      : "문서에 연대 책임 조항이 보이지 않습니다. 계약서에서 다시 확인하세요.");

  // ⑥ 실적 인정 — 다음 입찰에 쓸 실적이 지분율만큼만 잡힌다
  const perf = jvLines.find((l) => /실적/.test(l)) || hit(/(지분율|출자\s*비율)[^.]{0,20}실적/);
  if (perf) add("실적 인정", perf, cut(perf, 110), "공동수급 실적은 보통 지분율만큼만 인정됩니다. 다음 입찰 자격까지 보고 지분을 정하세요.");

  // ⑦ 과업 분담 명시 요구 — 적어 내야 하면 오히려 기회
  const split = jvLines.find((l) => /(분담\s*내용|담당\s*업무|업무\s*분장|이행\s*계획서)/.test(l));
  if (split) { add("과업 분담 명시", split, cut(split, 110), "제출 서류에 분담 내용을 적게 되어 있습니다. 여기에 우리 범위를 분명히 써 두면 나중에 다툼이 줄어듭니다."); }
  else checks.push("누가 어디까지 하는지 경계를 협정서·분담계획서에 문장으로 기재");

  // 공통 협상 항목 — 실제로 틀어지는 지점들
  checks.push("추가·수정 과업이 생겼을 때 비용을 누가 대는지 미리 합의");
  checks.push("검수 지연·재작업 책임을 업무 경계에 따라 나누기");
  checks.push("중도 이탈·분쟁 시 정산 방법 합의");

  return { applies: true, mode, items, checks, risks,
    note: "공동사업은 마진·과업 범위·역할·지분에서 틀어집니다. 협정서에 숫자와 경계를 적어 두는 것이 사업을 지키는 방법입니다." };
}
