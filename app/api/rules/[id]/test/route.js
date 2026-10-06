import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { sendNtfy } from "@/lib/ntfy";

export async function POST(req, { params }) {
  const { id } = await params;
  const { data: rule, error } = await db().from("rules").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  try {
    await sendNtfy({
      topic: rule.topic,
      title: `[테스트] ${rule.name}`,
      message: "이 알림이 보이면 구독이 정상입니다.",
      url: "https://www.g2b.go.kr",
      tags: ["white_check_mark"],
      priority: 3,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}
