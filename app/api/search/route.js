import { NextResponse } from "next/server";
import { searchBids } from "@/lib/g2b";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// 나라장터에서 공고명으로 바로 찾기: /api/search?q=청소&kind=servc&days=30
export async function GET(req) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim().slice(0, 40);
  if (!q) return NextResponse.json({ items: [] });
  try {
    const items = await searchBids(q, { kind: sp.get("kind") || "servc", days: Number(sp.get("days") || 30) });
    const { data } = items.length ? await db().from("bids").select("key, status").in("key", items.map((x) => x.key)) : { data: [] };
    const saved = new Map((data || []).map((x) => [x.key, x.status]));
    return NextResponse.json({ items: items.map((x) => ({ ...x, saved: saved.get(x.key) || null })) });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}
