import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { cleanRule } from "@/lib/rules";

export async function PATCH(req, { params }) {
  const { id } = await params;
  try {
    const patch = cleanRule(await req.json(), true);
    const { data, error } = await db().from("rules").update(patch).eq("id", id).select().single();
    if (error) throw error.message;
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function DELETE(req, { params }) {
  const { id } = await params;
  const { error } = await db().from("rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
