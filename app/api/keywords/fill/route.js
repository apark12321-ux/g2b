import { NextResponse } from "next/server";
import { getSettings, backfillKeywords } from "@/lib/keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 새 키워드의 최근 30일 공고 채우기 { words: string[], pairs?: [[단어, 업무구분]] }
//  → { filled, failed } — failed가 남으면 화면이 그 조합만 다시 요청한다
export async function POST(req) {
  try {
    const { words = [], pairs = null } = await req.json().catch(() => ({}));
    const settings = await getSettings();
    const list = words.filter((w) => (settings.include || []).includes(w));
    if (!list.length && !pairs?.length) return NextResponse.json({ filled: 0, failed: [] });
    const r = await backfillKeywords(list, settings, { pairs: pairs?.filter(([w]) => (settings.include || []).includes(w)), budgetMs: 40000 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
