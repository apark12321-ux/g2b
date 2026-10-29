import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 낙찰정보서비스 응답 확인용 (임시) — 공개 데이터의 항목 이름과 샘플 1건만 돌려줌
const BASES = ["https://apis.data.go.kr/1230000/as/ScsbidInfoService", "https://apis.data.go.kr/1230000/ScsbidInfoService"];
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-T:]/g, "");

async function call(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctl.signal });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch {}
    const body = j?.response?.body;
    let items = body?.items;
    if (items && !Array.isArray(items)) items = items.item ? [].concat(items.item) : [];
    return {
      status: r.status,
      code: j?.response?.header?.resultCode,
      msg: j?.response?.header?.resultMsg,
      total: body?.totalCount,
      keys: items?.[0] ? Object.keys(items[0]) : null,
      sample: items?.[0] || null,
      raw: j ? undefined : text.slice(0, 300),
    };
  } catch (e) {
    return { error: e.name === "AbortError" ? "timeout" : e.message };
  } finally { clearTimeout(t); }
}

export async function GET(req) {
  const key = process.env.G2B_API_KEY;
  if (!key) return NextResponse.json({ error: "no key" });
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") || "Servc";
  const end = new Date(Date.now() - 24 * 3600e3);
  const start = new Date(end.getTime() - 24 * 3600e3);
  const p = (o) => new URLSearchParams({ serviceKey: key, pageNo: "1", numOfRows: "3", type: "json", ...o }).toString();
  const range = { inqryDiv: "1", inqryBgnDt: kst(start), inqryEndDt: kst(end) };
  const out = {};
  for (const base of BASES) {
    const tag = base.includes("/as/") ? "as" : "old";
    const list = await call(`${base}/getOpengResultListInfo${kind}?${p(range)}`);
    out[`${tag}:getOpengResultListInfo${kind}`] = list;
    out[`${tag}:getScsbidListSttus${kind}`] = await call(`${base}/getScsbidListSttus${kind}?${p(range)}`);
    const no = list.sample?.bidNtceNo;
    if (no) {
      const one = { inqryDiv: "2", bidNtceNo: no, bidNtceOrd: list.sample?.bidNtceOrd || "000" };
      out[`${tag}:getOpengResultListInfoOpengCompt`] = await call(`${base}/getOpengResultListInfoOpengCompt?${p({ ...one, numOfRows: "5" })}`);
      out[`${tag}:getOpengResultListInfo${kind}PreparPcDetail`] = await call(`${base}/getOpengResultListInfo${kind}PreparPcDetail?${p({ ...one, numOfRows: "15" })}`);
      out[`${tag}:getOpengResultListInfoFailing`] = await call(`${base}/getOpengResultListInfoFailing?${p(one)}`);
    }
    if (list.keys) break;
  }
  return NextResponse.json(out);
}
