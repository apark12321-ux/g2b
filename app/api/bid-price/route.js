import { NextResponse } from "next/server";
import { bidPrice } from "@/lib/bidprice";

export const dynamic = "force-dynamic";

// 공고 1건의 투찰 기준 (공개 데이터만 사용)
export async function GET(req) {
  const q = req.nextUrl.searchParams;
  const no = (q.get("no") || "").trim();
  const ord = (q.get("ord") || "000").trim();
  const kind = (q.get("kind") || "servc").trim();
  if (!/^[A-Z0-9-]{6,30}$/i.test(no)) return NextResponse.json({ error: "공고번호가 올바르지 않음" }, { status: 400 });
  try {
    const data = await bidPrice({ bidNo: no, ord, kind });
    return NextResponse.json(data, { headers: { "Cache-Control": "s-maxage=600" } });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}
