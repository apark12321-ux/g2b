import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
export async function POST(req) {
  const { sub } = await req.json().catch(() => ({}));
  if (!sub?.endpoint) return NextResponse.json({ error: "구독 정보가 없습니다." }, { status: 400 });
  const { error } = await db().from("push_subs").upsert({ endpoint: sub.endpoint, sub, ua: req.headers.get("user-agent") || "" });
  if (error) return NextResponse.json({ error: /push_subs/.test(error.message) ? "push_subs 표가 없습니다. 안내된 SQL을 먼저 실행하세요." : error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
