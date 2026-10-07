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
  // 비용 항목 끄기/켜기
  if (Array.isArray(body.costOff)) {
    const { data: cur } = await db().from("bids").select("analysis").eq("key", decodeURIComponent(key)).single();
    patch.analysis = { ...(cur?.analysis || {}), costOff: body.costOff.map(String).slice(0, 50) };
  }
  // 실제 수행기간(개월) 직접 지정: 분석 결과에 덮어씀
  if (body.periodMonths !== undefined) {
    const m = Number(body.periodMonths);
    const { data: cur } = await db().from("bids").select("analysis").eq("key", decodeURIComponent(key)).single();
    patch.analysis = { ...(cur?.analysis || {}), periodMonths: m > 0 && m <= 60 ? m : null };
  }
  const { data, error } = await db().from("bids").update(patch).eq("key", decodeURIComponent(key)).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
