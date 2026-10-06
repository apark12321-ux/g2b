import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

const STATUS = ["new", "review", "join", "pass"];

export async function PATCH(req, { params }) {
  const { key } = await params;
  const body = await req.json().catch(() => ({}));
  const patch = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    if (!STATUS.includes(body.status)) return NextResponse.json({ error: "잘못된 상태값" }, { status: 400 });
    patch.status = body.status;
  }
  if (body.memo !== undefined) patch.memo = String(body.memo).slice(0, 2000);
  const { data, error } = await db().from("bids").update(patch).eq("key", decodeURIComponent(key)).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
