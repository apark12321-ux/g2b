import { NextResponse } from "next/server";
import { POPULAR, recentWords } from "@/lib/trending";

export const dynamic = "force-dynamic";
export const maxDuration = 40;

// /api/trending?kind=servc → { popular: [...], recent: [{w, n}] }
export async function GET(req) {
  const kind = req.nextUrl.searchParams.get("kind") || "servc";
  if (!POPULAR[kind]) return NextResponse.json({ error: "잘못된 업무구분" }, { status: 400 });
  let recent = [];
  try { recent = await recentWords(kind); } catch (e) { console.error("최근 키워드 실패", e); }
  return NextResponse.json({ popular: POPULAR[kind], recent });
}
