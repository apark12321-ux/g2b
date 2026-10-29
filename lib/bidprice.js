// 투찰 기준: 나라장터가 공개한 값(기초금액·예비가격 범위·낙찰하한율·낙찰 방법)만으로 계산
// 추정·가정 없이, 값이 없으면 계산하지 않고 이유를 돌려준다.
import { apiFetch, endpoint, fetchAllOrds, KINDS } from "@/lib/g2b";

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};
const apiName = (kind) => (KINDS.find((k) => k.key === kind) || KINDS[0]).api;

/** 기초금액 조회 (입찰공고정보서비스 · 기초금액) */
async function fetchBasis(bidNo, ord, kind) {
  const key = process.env.G2B_API_KEY;
  const qs = new URLSearchParams({ serviceKey: key, pageNo: "1", numOfRows: "10", inqryDiv: "2", bidNtceNo: bidNo, type: "json" });
  const res = await apiFetch(`${endpoint(`getBidPblancListInfo${apiName(kind)}BsisAmount`)}?${qs}`);
  const data = await res.json().catch(() => null);
  let items = data?.response?.body?.items || [];
  if (!Array.isArray(items)) items = items.item ? [].concat(items.item) : [];
  // 같은 차수 우선, 없으면 가장 최근 차수
  const same = items.filter((x) => (x.bidNtceOrd || "000") === ord);
  const pick = (same.length ? same : items).sort((a, b) => String(b.inptDt || "").localeCompare(String(a.inptDt || "")))[0];
  return pick || null;
}

/** 협상에 의한 계약: 기술·가격 점수 합산이라 하한 금액 개념이 없음 */
const isNegotiation = (m) => /협상/.test(m || "");

export async function bidPrice({ bidNo, ord = "000", kind = "servc" }) {
  if (!process.env.G2B_API_KEY) throw new Error("G2B_API_KEY 없음");
  const [ords, basis] = await Promise.all([fetchAllOrds(bidNo, kind), fetchBasis(bidNo, ord, kind)]);
  const meta = ords.find((x) => (x.bidNtceOrd || "000") === ord) || ords[ords.length - 1] || {};

  const method = meta.sucsfbidMthdNm || "";
  const contract = meta.cntrctCnclsMthdNm || "";
  const priceMethod = meta.prearngPrceDcsnMthdNm || ""; // 복수예가 / 단일예가 / 비예가
  const lwlt = num(meta.sucsfbidLwltRate); // 낙찰하한율(%)
  const bss = num(basis?.bssamt);
  const lo = num(basis?.rsrvtnPrceRngBgnRate);
  const hi = num(basis?.rsrvtnPrceRngEndRate);
  const presmpt = num(meta.presmptPrce);
  const techRt = num(meta.techAbltEvlRt);
  const priceRt = num(meta.bidPrceEvlRt);

  const out = {
    method, contract, priceMethod, lwlt, presmpt, opengDt: meta.opengDt || null,
    bss: bss > 0 ? bss : null, bssOpenDt: basis?.bssamtOpenDt || null,
    range: lo != null && hi != null ? { lo, hi } : null,
    weight: techRt > 0 && priceRt > 0 ? { tech: techRt, price: priceRt } : null,
    plan: null, floor: null, reasons: [],
  };

  const nego = isNegotiation(method + " " + contract);
  if (nego) { out.reasons.push("협상에 의한 계약 · 기술·가격 점수 합산으로 결정"); }
  else if (/비예가/.test(priceMethod)) { out.reasons.push("비예가 공고 · 기초금액·예정가격을 정하지 않음"); }
  if (!out.bss) { if (!out.reasons.length) out.reasons.push("기초금액 공개 전 · 공개되면 자동 표시"); return out; }
  if (out.range) {
    out.plan = { min: Math.round(bss * (1 + lo / 100)), max: Math.round(bss * (1 + hi / 100)), mid: bss };
  }
  if (nego) return out;
  if (kind === "cnstwk") { out.reasons.push("공사는 A값 반영이 필요해 하한 금액을 계산하지 않음"); return out; }
  if (!out.plan) { out.reasons.push("예비가격 범위가 없음"); return out; }
  if (lwlt > 0 && lwlt < 100) {
    // 예정가격 × 낙찰하한율 이상이어야 함 → 원 단위 올림
    const f = (v) => Math.ceil((v * lwlt) / 100);
    out.floor = { min: f(out.plan.min), mid: f(out.plan.mid), max: f(out.plan.max) };
  } else if (/예가\s*내|예정가격\s*이하|최저가/.test(method)) {
    // 하한 없이 예정가격 이내 최저가: 예정가격을 넘으면 무효
    out.ceil = { safe: Math.floor(bss * (1 + lo / 100)), over: Math.ceil(bss * (1 + hi / 100)) };
  } else {
    out.reasons.push("공고에 낙찰하한율이 없음");
  }
  return out;
}
