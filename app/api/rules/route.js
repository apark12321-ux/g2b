import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { cleanRule } from "@/lib/rules";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await db().from("rules").select("*").order("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req) {
  try {
    const rule = cleanRule(await req.json());
    const { data, error } = await db().from("rules").insert(rule).select().single();
    if (error) throw error.message;
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
