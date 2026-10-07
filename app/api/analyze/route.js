import { NextResponse } from "next/server";
import { analyzeBid } from "@/lib/analyze";
import { db } from "@/lib/supabase";
import { fillGaps } from "@/lib/fill-gaps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req) {
  const { key, force } = await req.json().catch(() => ({}));
  if (!key) return NextResponse.json({ error: "공고 번호가 없습니다." }, { status: 400 });
  try {
    return NextResponse.json(await analyzeBid(key, { force: !!force }));
  } catch (e) {
    // 마지막 안전장치: 공고 정보만으로 최소 리포트를 만들어 저장
    try {
      const supa = db();
      const { data: bid } = await supa.from("bids").select("*").eq("key", key).single();
      const result = fillGaps({ mode: "basic", fileStatus: [{ name: "분석", status: `오류로 공고 정보만 사용 (${String(e.message || e).slice(0, 60)})` }] }, bid || {}, null);
      result.video = { share: null, only: false, priority: false, low: false };
      result.review = { verdict: { level: "조건 확인 후 입찰", tone: "warn", reason: "첨부 분석 실패 — 원문 확인 필요" }, risks: [], unit: null, checklist: ["첨부 원문을 직접 확인"] };
      await supa.from("bids").update({ analysis: result, analyzed_at: new Date().toISOString() }).eq("key", key);
      return NextResponse.json({ ...result, _files: bid?.files });
    } catch (e2) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
    }
  }
}
