import { NextResponse } from "next/server";
import { getSettings, saveSettings, backfillKeywords } from "@/lib/keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const s = await getSettings();
    return NextResponse.json({ include: s.include || [], exclude: s.exclude || [], kinds: s.tags || [] });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// { include?: string[], exclude?: string[], kinds?: string[] }
export async function PUT(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { settings, added } = await saveSettings(body);
    let filled = 0;
    if (added.length) filled = await backfillKeywords(added, settings);
    return NextResponse.json({ include: settings.include, exclude: settings.exclude, kinds: settings.tags || [], added, filled });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
