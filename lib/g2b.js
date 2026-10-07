const API_URL =
  process.env.G2B_API_URL ||
  "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc";

function kstStamp(d) {
  return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

/** 최근 hours시간 동안 게시된 용역 공고 전체 */
/** div 1: 공고 등록일시 기준, 3: 변경일시 기준(정정공고 포함) */
export async function fetchBids(hours, div = "1") {
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
      inqryDiv: String(div),
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

/** 공고번호의 모든 차수 */
export async function fetchAllOrds(bidNo) {
  const key = process.env.G2B_API_KEY;
  if (!key || !bidNo) return [];
  const qs = new URLSearchParams({
    serviceKey: key, pageNo: "1", numOfRows: "20", inqryDiv: "2", bidNtceNo: bidNo, type: "json",
  });
  try {
    const res = await fetch(`${API_URL}?${qs}`, { cache: "no-store" });
    const data = await res.json();
    let items = data?.response?.body?.items || [];
    if (!Array.isArray(items)) items = items.item || [];
    return Array.isArray(items) ? items : [items];
  } catch {
    return [];
  }
}

/** 이전 공고 첨부: 파일명 앞에 [이전 공고] 표시 */
export const asPrevFiles = (files, ord) =>
  (files || []).map((f) => ({
    ...f,
    name: /^\[이전 공고/.test(f.name) ? f.name : `[이전 공고${ord ? ` ${ord}차` : ""}] ${f.name}`,
    prev: true,
  }));

/** 정정공고에 첨부가 없으면 같은 공고번호의 이전 차수 첨부를 찾아 줌 */
export async function prevOrdFiles(bidNo, ord) {
  const items = await fetchAllOrds(bidNo);
  const older = items
    .filter((x) => Number(x.bidNtceOrd) < Number(ord))
    .sort((a, b) => Number(b.bidNtceOrd) - Number(a.bidNtceOrd));
  for (const it of older) {
    const f = filesOf(it);
    if (f.length) return asPrevFiles(f, String(it.bidNtceOrd));
  }
  return [];
}

export async function fetchBidByNo(bidNo, ord) {
  const items = await fetchAllOrds(bidNo);
  return items.find((x) => String(x.bidNtceOrd) === String(ord)) || items[items.length - 1] || null;
}

/** 같은 사업인지 판단하는 키: 공고기관 + 공고명(정정·재공고·긴급 표시와 띄어쓰기 제거) */
export function sameBidKey(b) {
  const t = String(b.title || b.bidNtceNm || "")
    .replace(/[\[(（【]\s*(정정|재공고|재입찰|긴급|변경|취소)\s*[\])）】]/g, "")
    .replace(/(정정공고|재공고|긴급공고)/g, "")
    .replace(/[\s\-_·.,()\[\]]/g, "")
    .toLowerCase();
  return `${(b.org || b.ntceInsttNm || "").replace(/\s+/g, "")}|${t}`;
}

const ordNum = (b) => Number(String(b.bid_ord ?? b.bidNtceOrd ?? "0").replace(/\D/g, "") || 0);
const markedRevised = (b) => /(정정|재공고|재입찰|변경)/.test(String(b.title || b.bidNtceNm || ""));

/**
 * a가 b보다 최신 공고(정정·재공고)인가. 애매하면 false (지우지 않는 쪽으로)
 *  1) 같은 공고번호 → 차수가 높은 쪽
 *  2) 다른 공고번호 → 정정 차수가 있거나 정정·재공고 표시가 있는 쪽, 그다음 게시일시가 늦은 쪽
 */
export function isNewer(a, b) {
  if (a.bid_no && a.bid_no === b.bid_no) return ordNum(a) > ordNum(b);
  const ra = ordNum(a) > 0 || markedRevised(a);
  const rb = ordNum(b) > 0 || markedRevised(b);
  if (ra !== rb) return ra; // 정정 쪽을 우선
  const ta = new Date(a.posted_at || a.bidNtceDt || 0).getTime();
  const tb = new Date(b.posted_at || b.bidNtceDt || 0).getTime();
  if (ta !== tb) return ta > tb;
  return ordNum(a) > ordNum(b);
}

/** 참가가능지역 목록 (비어 있으면 지역 제한 없음 = 전국) */
export async function fetchRegions(bidNo, ord) {
  const key = process.env.G2B_API_KEY;
  if (!key || !bidNo) return null;
  const url = API_URL.replace(/[^/]+$/, "getBidPblancListInfoPrtcptPsblRgn");
  const qs = new URLSearchParams({
    serviceKey: key, pageNo: "1", numOfRows: "50", inqryDiv: "2",
    bidNtceNo: bidNo, bidNtceOrd: String(ord || "000"), type: "json",
  });
  try {
    const res = await fetch(`${url}?${qs}`, { cache: "no-store" });
    const data = await res.json();
    let items = data?.response?.body?.items || [];
    if (!Array.isArray(items)) items = items.item || [];
    if (!Array.isArray(items)) items = [items];
    return [...new Set(items.map((x) => String(x.prtcptPsblRgnNm || "").trim()).filter(Boolean))];
  } catch {
    return null; // 조회 실패: 판단 보류
  }
}

/** 서울 외 지역으로만 참가가 제한된 공고인가 */
export function regionBlocked(regions) {
  if (!regions || !regions.length) return false;
  if (regions.some((r) => /서울|전국/.test(r))) return false;
  return true;
}
