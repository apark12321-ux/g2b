import { NextResponse } from "next/server";
import { analyzePending } from "@/lib/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 기존 공고를 새 분석 방식으로 일괄 갱신: /api/reanalyze?key=CRON_SECRET
// 한 번에 시간이 허락하는 만큼 처리하고 남은 개수를 알려 줌 (다시 열면 이어서 처리)
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.nextUrl.searchParams.get("key") !== secret) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }
  const started = Date.now();
  const r = await analyzePending(started + 240_000, 50);
  return NextResponse.json({ 갱신: r.done, 남은_공고: r.left, 안내: r.left ? "이 주소를 다시 열면 이어서 갱신합니다 (10분마다 자동으로도 진행)" : "모두 최신입니다" });
}

// 사이트의 '분석 전체 갱신' 버튼
export async function POST() {
  const started = Date.now();
  const r = await analyzePending(started + 240_000, 50);
  return NextResponse.json({ done: r.done, left: r.left });
}
