import { NextResponse } from "next/server";
import { fetchAllOrds } from "@/lib/g2b";
import { pastOpenings } from "@/lib/opening";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 공고 1건의 같은 수요기관 과거 개찰 결과 (최근 12개월)
export async function GET(req) {
  const q = req.nextUrl.searchParams;
  const no = (q.get("no") || "").trim();
  const ord = (q.get("ord") || "000").trim();
  const kind = (q.get("kind") || "servc").trim();
  if (!/^[A-Z0-9-]{6,30}$/i.test(no)) return NextResponse.json({ error: "공고번호가 올바르지 않음" }, { status: 400 });
  try {
    const ords = await fetchAllOrds(no, kind);
    const meta = ords.find((x) => (x.bidNtceOrd || "000") === ord) || ords[ords.length - 1] || {};
    const data = await pastOpenings({ dminsttCd: meta.dminsttCd, kind, excludeNo: no });
    return NextResponse.json(
      { instt: meta.dminsttNm || "", ...data },
      { headers: { "Cache-Control": "s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}
