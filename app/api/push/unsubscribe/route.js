import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
export async function POST(req) {
  const { endpoint } = await req.json().catch(() => ({}));
  if (endpoint) await db().from("push_subs").delete().eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
