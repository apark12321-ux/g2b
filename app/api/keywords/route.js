import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/keywords";

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
    // 저장만 바로 하고, 최근 30일 공고 채우기는 화면이 /api/keywords/fill 로 따로 요청한다 (시간 초과 방지)
    const { settings, added } = await saveSettings(body);
    return NextResponse.json({ include: settings.include, exclude: settings.exclude, kinds: settings.tags || [], added });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
