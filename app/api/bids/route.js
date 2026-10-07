import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getSettings } from "@/lib/keywords";
import { isExcluded as excluded } from "@/lib/watch-words";

export const dynamic = "force-dynamic";

// 같은 공고번호가 여러 차수로 있으면 최신 차수(정정공고)만
function latestOnly(list) {
  const top = new Map();
  for (const b of list) {
    if (String(b.key).startsWith("TEST-")) continue;
    const cur = top.get(b.bid_no);
    if (!cur || Number(b.bid_ord) > Number(cur.bid_ord)) top.set(b.bid_no, b);
  }
  return list.filter((b) => String(b.key).startsWith("TEST-") || top.get(b.bid_no) === b);
}

export async function GET() {
  try {
    const supa = db();
    const [bids, runs, settings] = await Promise.all([
      supa.from("bids").select("*").order("created_at", { ascending: false }).limit(500),
      supa.from("runs").select("*").order("ran_at", { ascending: false }).limit(1),
      getSettings(),
    ]);
    const err = bids.error || runs.error;
    if (err) throw err;
    return NextResponse.json({
      bids: latestOnly(bids.data.filter((b) => b.status === "review" || b.status === "join" || !excluded(b.title))),
      lastRun: runs.data[0] || null,
      topic: settings.topic,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
