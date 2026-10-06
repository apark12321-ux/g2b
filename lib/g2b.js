const API_URL =
  process.env.G2B_API_URL ||
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc";

function kstStamp(d) {
  return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

/** 최근 hours시간 동안 게시된 용역 공고 전체 */
export async function fetchBids(hours) {
  const key = process.env.G2B_API_KEY;
  if (!key) throw new Error("G2B_API_KEY 환경변수를 설정하세요.");
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600e3);
  const rows = 100;
  const out = [];
  for (let page = 1; page <= 60; page++) {
    const qs = new URLSearchParams({
      serviceKey: key,
      pageNo: String(page),
      numOfRows: String(rows),
      inqryDiv: "1",
      inqryBgnDt: kstStamp(start),
      inqryEndDt: kstStamp(end),
      type: "json",
    });
    const res = await fetch(`${API_URL}?${qs}`, { cache: "no-store" });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`나라장터 API 응답을 읽지 못했습니다. 인증키와 요청주소를 확인하세요: ${text.slice(0, 200)}`);
    }
    const header = data?.response?.header || {};
    if (header.resultCode && header.resultCode !== "00") {
      throw new Error(`나라장터 API 오류 ${header.resultCode}: ${header.resultMsg}`);
    }
    const body = data?.response?.body || {};
    let items = body.items || [];
    if (!Array.isArray(items)) items = items.item || [];
    if (!Array.isArray(items)) items = [items];
    out.push(...items);
    if (!items.length || page * rows >= Number(body.totalCount || 0)) break;
  }
  return out;
}

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "");

/** 포함어 중 걸린 단어 목록. 제외어가 있으면 빈 배열 */
export function matchRule(rule, title) {
  const t = norm(title);
  const hits = (rule.include || []).filter((k) => norm(k) && t.includes(norm(k)));
  if (!hits.length) return [];
  const ex = (x) =>
    x instanceof RegExp ? x.test(t) : Array.isArray(x) ? x.every((w) => t.includes(norm(w))) : norm(x) && t.includes(norm(x));
  if ((rule.exclude || []).some(ex)) return [];
  return hits;
}

function parseKst(s) {
  const m = String(s || "").match(/^(\d{4})\D?(\d{2})\D?(\d{2})\D?(\d{2})\D?(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`).toISOString();
}

export function filesOf(b) {
  const clean = (u) => String(u || "").replace(/&amp;/g, "&").replace(/\s+/g, "").trim();
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const url = clean(b[`ntceSpecDocUrl${i}`]);
    if (url) out.push({ name: String(b[`ntceSpecFileNm${i}`] || "").trim() || `첨부파일 ${i}`, url });
  }
  const std = clean(b.stdNtceDocUrl);
  if (std && !out.some((f) => f.url === std)) out.push({ name: "표준공고서", url: std });
  return out;
}

export function toRow(b) {
  const price = Number(b.presmptPrce || b.asignBdgtAmt || 0);
  return {
    key: `${b.bidNtceNo}-${b.bidNtceOrd || "000"}`,
    bid_no: b.bidNtceNo,
    bid_ord: b.bidNtceOrd || "000",
    title: b.bidNtceNm || "(제목 없음)",
    org: b.ntceInsttNm || null,
    demand_org: b.dminsttNm || null,
    price: price > 0 ? Math.round(price) : null,
    posted_at: parseKst(b.bidNtceDt),
    close_at: parseKst(b.bidClseDt),
    url: b.bidNtceDtlUrl || b.bidNtceUrl || "https://www.g2b.go.kr",
    files: filesOf(b),
  };
}

export const isRevised = (ord) => String(ord || "").replace(/0/g, "") !== "";

/** 공고번호로 공고 1건 다시 조회 (첨부파일 목록 보충용) */
export async function fetchBidByNo(bidNo, ord) {
  const key = process.env.G2B_API_KEY;
  if (!key || !bidNo) return null;
  const qs = new URLSearchParams({
    serviceKey: key, pageNo: "1", numOfRows: "20", inqryDiv: "2", bidNtceNo: bidNo, type: "json",
  });
  const res = await fetch(`${API_URL}?${qs}`, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  let items = data?.response?.body?.items || [];
  if (!Array.isArray(items)) items = items.item || [];
  if (!Array.isArray(items)) items = [items];
  return items.find((x) => String(x.bidNtceOrd) === String(ord)) || items[items.length - 1] || null;
}
