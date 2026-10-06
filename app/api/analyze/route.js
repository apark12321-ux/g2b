import { NextResponse } from "next/server";
import { analyzeBid } from "@/lib/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req) {
  const { key } = await req.json().catch(() => ({}));
  if (!key) return NextResponse.json({ error: "공고 번호가 없습니다." }, { status: 400 });
  try {
    return NextResponse.json(await analyzeBid(key));
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
