import { NextResponse } from "next/server";
import { getSettings } from "@/lib/keywords";
import { sendNtfy } from "@/lib/ntfy";

export async function POST() {
  try {
    const s = await getSettings();
    await sendNtfy({
      topic: s.topic,
      title: "[테스트] 나라장터 입찰 알림",
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
