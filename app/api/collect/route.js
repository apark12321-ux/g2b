import { NextResponse } from "next/server";
import { runCollect } from "@/lib/collect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 수집만 하고 바로 응답한다. '미리 분석'은 /api/analyze-pending 이 따로 맡는다 —
// 한 요청에 둘 다 하면 60초를 넘겨 504가 나고, 부른 쪽은 수집이 됐는지조차 알 수 없게 된다.
const OPTS = { analyze: false };

// GET: 자동 수집 - 비밀값 필요
// cron-job.org는 ?key=..., Vercel Cron·GitHub Actions는 Authorization: Bearer ... 로 보낸다
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const byQuery = req.nextUrl.searchParams.get("key") === secret;
    const byHeader = req.headers.get("authorization") === `Bearer ${secret}`;
    if (!byQuery && !byHeader) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
    }
  }
  // ?hours=72 : 최근 72시간을 다시 조회해 빠진 공고(정정공고 등)를 알림 없이 채움
  const h = Number(req.nextUrl.searchParams.get("hours") || 0);
  const run = await runCollect(h > 0 ? { ...OPTS, hours: Math.min(h, 168), quiet: true } : OPTS);
  return NextResponse.json(run, { status: run.error ? 500 : 200 });
}

// POST: 사이트의 '지금 수집' 버튼, 화면의 자동 복구
export async function POST() {
  const run = await runCollect(OPTS);
  return NextResponse.json(run, { status: run.error ? 500 : 200 });
}
