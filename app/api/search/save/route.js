import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getSettings } from "@/lib/keywords";
import { withKindTag } from "@/lib/g2b";

export const dynamic = "force-dynamic";

// 검색 결과 한 건을 '검토'로 담기 { row, keyword }
export async function POST(req) {
  const { row, keyword } = await req.json().catch(() => ({}));
  if (!row?.key || !row?.title) return NextResponse.json({ error: "공고 정보가 없습니다" }, { status: 400 });
  try {
    const s = await getSettings();
    const pick = ({ key, bid_no, bid_ord, title, org, demand_org, price, posted_at, close_at, url, files, kind }) =>
      ({ key, bid_no, bid_ord, title, org, demand_org, price, posted_at, close_at, url, files: files || [], kind });
    const { data: cur } = await db().from("bids").select("key, status").eq("key", row.key).maybeSingle();
    const record = { ...pick(row), status: cur && cur.status !== "new" && cur.status !== "pass" ? cur.status : "review",
      matched_rules: ["검색"], keywords: keyword ? [keyword] : [], notified_rule_ids: [s.id], updated_at: new Date().toISOString() };
    const { data, error } = await db().from("bids").upsert(withKindTag(record), { onConflict: "key" }).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
