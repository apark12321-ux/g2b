import { NextResponse } from "next/server";
import { runCollect } from "@/lib/collect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: 자동 수집(cron-job.org) - 비밀값 필요
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.nextUrl.searchParams.get("key") !== secret) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }
  const run = await runCollect();
  return NextResponse.json(run, { status: run.error ? 500 : 200 });
}

// POST: 사이트의 '지금 수집' 버튼
export async function POST() {
  const run = await runCollect();
  return NextResponse.json(run, { status: run.error ? 500 : 200 });
}
