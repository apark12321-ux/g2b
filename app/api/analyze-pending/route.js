import { NextResponse } from "next/server";
import { analyzePending } from "@/lib/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 아직 분석되지 않은 공고를 한 건만 분석한다. 한 건이 수십 초 걸리므로 한 요청에 하나씩.
// 남은 건수(left)를 돌려주니, 부른 쪽이 0이 될 때까지 반복하면 된다.
export async function POST() {
  const r = await analyzePending(Date.now() + 40_000, 1);
  return NextResponse.json(r);
}
