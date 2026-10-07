import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getSettings } from "@/lib/keywords";
import { sameBidKey, isNewer } from "@/lib/g2b";
import { isExcluded as excluded } from "@/lib/watch-words";

export const dynamic = "force-dynamic";

// 같은 공고번호가 여러 차수로 있으면 최신 차수(정정공고)만
function latestOnly(list) {
  const pick = new Map();
  const keyOf = new Map();
  for (const b of list) {
    if (String(b.key).startsWith("TEST-")) continue;
    const k1 = `no:${b.bid_no}`, k2 = `t:${sameBidKey(b)}`;
    const g = keyOf.get(k1) || keyOf.get(k2) || k1;
    keyOf.set(k1, g); keyOf.set(k2, g);
    const cur = pick.get(g);
    if (!cur || isNewer(b, cur)) pick.set(g, b);
  }
  const keep = new Set(pick.values());
  return list.filter((b) => String(b.key).startsWith("TEST-") || keep.has(b));
}

export async function GET() {
  try {
    const supa = db();
    const [bids, runs, settings, cm] = await Promise.all([
      supa.from("bids").select("*").order("created_at", { ascending: false }).limit(500),
      supa.from("runs").select("*").order("ran_at", { ascending: false }).limit(1),
      getSettings(),
      supa.from("app_settings").select("value").eq("key", "cost_model").maybeSingle(),
    ]);
    const err = bids.error || runs.error;
    if (err) throw err;
    return NextResponse.json({
      bids: latestOnly(bids.data.filter((b) => b.status === "review" || b.status === "join" || !excluded(b.title))),
      lastRun: runs.data[0] || null,
      topic: settings.topic,
      costModel: cm?.data?.value ? JSON.parse(cm.data.value) : {},
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
