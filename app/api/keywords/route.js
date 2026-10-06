import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/keywords";

export const dynamic = "force-dynamic";

const pick = (r) => ({ include: r.include, exclude: r.exclude, topic: r.topic, active: r.active });

export async function GET() {
  try {
    return NextResponse.json(pick(await getSettings()));
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    return NextResponse.json(pick(await saveSettings(await req.json())));
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
