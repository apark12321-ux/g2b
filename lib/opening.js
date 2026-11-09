// 과거 개찰 결과 (조달청 낙찰정보서비스): 같은 수요기관 최근 12개월
// 실제 예정가격(사정률) · 1순위 투찰 금액 · 참여 업체 수 — 모두 나라장터 공개값, 추정 없음
import { fetchAllOrds, KINDS } from "@/lib/g2b";

const BASE = "https://apis.data.go.kr/1230000/as/ScsbidInfoService";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};
const ymd = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
const apiName = (kind) => (KINDS.find((k) => k.key === kind) || KINDS[0]).api;

/** 낙찰정보서비스 호출: 초당 호출 제한(23) 시 대기 후 재시도 */
async function call(op, params, tries = 5) {
  const key = process.env.SCSBID_API_KEY || process.env.G2B_API_KEY;
  const qs = new URLSearchParams({ serviceKey: key, pageNo: "1", numOfRows: "100", type: "json", ...params });
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(`${BASE}/${op}?${qs}`, { cache: "no-store", signal: ctl.signal });
      const text = await res.text();
      if (/PER_SECOND/.test(text)) { await sleep(700 * (i + 1)); continue; }
      if (/SERVICE_KEY_IS_NOT_REGISTERED/.test(text)) throw Object.assign(new Error("낙찰정보서비스 미등록 키 · Vercel 환경변수 SCSBID_API_KEY 등록 필요"), { fatal: true });
      const j = JSON.parse(text);
      let items = j?.response?.body?.items || [];
      if (!Array.isArray(items)) items = items.item ? [].concat(items.item) : [];
      return items;
    } catch (e) {
      if (e.fatal) throw e;
      if (i === tries - 1) return null;
      await sleep(800 * (i + 1));
    } finally { clearTimeout(timer); }
  }
  return null;
}

/** 같은 수요기관 개찰 목록 (31일 단위 조회 제한 → 기간 분할) */
async function listByInstt(dminsttCd, kind, months) {
  const now = Date.now();
  const out = [];
  for (let m = 0; m < months; m++) {
    const end = new Date(now - m * 30 * 864e5), start = new Date(now - (m + 1) * 30 * 864e5 + 864e5);
    const items = await call(`getOpengResultListInfo${apiName(kind)}PPSSrch`, {
      inqryDiv: "2", inqryBgnDt: `${ymd(start)}0000`, inqryEndDt: `${ymd(end)}2359`, dminsttCd,
    });
    if (items) out.push(...items);
    await sleep(120);
  }
  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.bidNtceNo}-${x.bidNtceOrd}-${x.rbidNo || ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 1건 상세: 예비가격 15개·예정가격 + 개찰 순위 + 공고 조건(하한율·낙찰 방법) */
async function detail(x, kind) {
  const one = { inqryDiv: "2", bidNtceNo: x.bidNtceNo, bidNtceOrd: x.bidNtceOrd || "000", numOfRows: "30" };
  const pre = x.rsrvtnPrceFileExistnceYn === "Y" ? await call(`getOpengResultListInfo${apiName(kind)}PreparPcDetail`, one) : null;
  await sleep(100);
  const rank = await call("getOpengResultListInfoOpengCompt", { ...one, numOfRows: "5" });
  await sleep(100);
  const ords = await fetchAllOrds(x.bidNtceNo, kind);
  const meta = ords.find((o) => (o.bidNtceOrd || "000") === (x.bidNtceOrd || "000")) || ords[ords.length - 1] || {};

  const rb = x.rbidNo || "000";
  const preRows = (pre || []).filter((p) => (p.rbidNo || "000") === rb);
  const bss = num(preRows[0]?.bssamt);
  const plan = num(preRows[0]?.plnprc);
  const first = (rank || []).filter((r) => (r.rbidNo || "000") === rb).find((r) => String(r.opengRank).trim() === "1");
  const firstAmt = num(first?.bidprcAmt);
  return {
    no: x.bidNtceNo, ord: x.bidNtceOrd || "000", name: x.bidNtceNm, date: String(x.opengDt || "").slice(0, 10),
    prtc: num(x.prtcptCnum),
    method: meta.sucsfbidMthdNm || "", priceMethod: meta.prearngPrceDcsnMthdNm || "",
    lwlt: num(meta.sucsfbidLwltRate),
    bss: bss > 0 ? bss : null,
    // 사정률(%) = 예정가격 ÷ 기초금액 × 100
    rate: bss > 0 && plan > 0 ? Math.round((plan / bss) * 1e6) / 1e4 : null,
    // 1순위 투찰 금액 ÷ 기초금액 (%) / 1순위 투찰률(예정가격 대비, 나라장터 값)
    firstBss: bss > 0 && firstAmt > 0 ? Math.round((firstAmt / bss) * 1e6) / 1e4 : null,
    firstPlan: num(first?.bidprcrt),
    pre: preRows.length === 15 ? preRows.map((p) => Math.round((num(p.bsisPlnprc) / bss) * 1e6) / 1e4) : null,
    // 범위: 공고 기초금액 조회값이 없으므로 예비가격 최소·최대로 판정 (±2% / ±3%)
  };
}


/**
 * 과거 개찰 분석
 * @param {{dminsttCd:string, kind?:string, excludeNo?:string, months?:number, max?:number}} o
 */
export async function pastOpenings({ dminsttCd, kind = "servc", excludeNo, months = 12, max = 15 }) {
  if (!dminsttCd) return { rows: [], reason: "수요기관 코드 없음" };
  const list = (await listByInstt(dminsttCd, kind, months))
    .filter((x) => x.progrsDivCdNm === "개찰완료" && x.bidNtceNo !== excludeNo)
    .sort((a, b) => String(b.opengDt).localeCompare(String(a.opengDt)))
    .slice(0, max);
  const rows = [];
  for (const x of list) {
    try { rows.push(await detail(x, kind)); } catch (e) { if (e.fatal) throw e; }
  }
  return { rows, scanned: list.length, months };
}
