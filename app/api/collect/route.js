import { NextResponse } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { runCollect } from "@/lib/collect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function allowed(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.nextUrl.searchParams.get("key") === secret) return true;
    if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  }
  return isLoggedIn(req);
}

async function handle(req) {
  if (!(await allowed(req))) return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  const run = await runCollect();
  return NextResponse.json(run, { status: run.error ? 500 : 200 });
}
export const GET = handle;
export const POST = handle;
