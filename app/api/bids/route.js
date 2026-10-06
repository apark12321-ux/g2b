import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supa = db();
    const [bids, runs, rules] = await Promise.all([
      supa.from("bids").select("*").order("created_at", { ascending: false }).limit(500),
      supa.from("runs").select("*").order("ran_at", { ascending: false }).limit(1),
      supa.from("rules").select("name").order("id"),
    ]);
    const err = bids.error || runs.error || rules.error;
    if (err) throw err;
    return NextResponse.json({
      bids: bids.data,
      lastRun: runs.data[0] || null,
      ruleNames: rules.data.map((r) => r.name),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
