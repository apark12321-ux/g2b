import { NextResponse } from "next/server";
import { pushAll } from "@/lib/webpush";
export async function POST(req) {
  const { endpoint } = await req.json().catch(() => ({}));
  try {
    const n = await pushAll({ title: "[테스트] 나라장터 입찰알림", body: "이 기기에서 알림을 받을 수 있습니다.", url: "/" }, endpoint);
    if (!n) return NextResponse.json({ error: "이 기기의 구독 정보를 찾지 못했습니다. 알림 받기를 다시 눌러 주세요." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
