import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const KEYS = ["rateHigh", "internalPeople", "internalMonthly", "ownFacility", "rateMid", "rateLow", "days", "teamMax", "burden", "overhead", "rework", "contingency", "fixedMonthly", "pmPerMonth", "proposalMM", ...["차시", "편", "편집", "쇼츠"].flatMap((k) => [`mm_${k}`, `direct_${k}`])];

export async function GET() {
  const { data } = await db().from("app_settings").select("value").eq("key", "cost_model").maybeSingle();
  return NextResponse.json(data?.value ? JSON.parse(data.value) : {});
}

export async function PUT(req) {
  const body = await req.json().catch(() => ({}));
  const clean = {};
  for (const k of KEYS) if (body[k] !== undefined && body[k] !== "" && !isNaN(Number(body[k]))) clean[k] = Number(body[k]);
  const { error } = await db().from("app_settings").upsert({ key: "cost_model", value: JSON.stringify(clean) });
  if (error) return NextResponse.json({ error: /app_settings/.test(error.message) ? "app_settings 표가 없습니다. 안내된 SQL을 먼저 실행하세요." : error.message }, { status: 500 });
  return NextResponse.json(clean);
}
