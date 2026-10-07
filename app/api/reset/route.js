import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { runCollect } from "@/lib/collect";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 공고 초기화 후 지정일부터 다시 수집 (알림 없이)
//   /api/reset?key=CRON_SECRET&from=2026-10-01        → 검토·참여·불참 상태와 체크 기록은 공고번호로 되살림
//   /api/reset?key=CRON_SECRET&from=2026-10-01&keep=0 → 상태까지 전부 지움
export async function GET(req) {
  const sp = req.nextUrl.searchParams;
  const secret = process.env.CRON_SECRET;
  if (secret && sp.get("key") !== secret) return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });

  const from = new Date(`${sp.get("from") || "2026-10-01"}T00:00:00+09:00`);
  if (isNaN(from)) return NextResponse.json({ error: "from 날짜 형식은 2026-10-01 처럼" }, { status: 400 });
  const hours = Math.ceil((Date.now() - from.getTime()) / 3600e3);
  if (hours <= 0 || hours > 24 * 31) return NextResponse.json({ error: "최근 31일 이내 날짜만 가능합니다." }, { status: 400 });
  const keep = sp.get("keep") !== "0";
  const supa = db();

  // 1) 사람이 정해 둔 상태 백업 (공고번호 기준)
  let saved = [];
  if (keep) {
    const { data } = await supa.from("bids").select("bid_no, status, memo, analysis").neq("status", "new");
    saved = (data || []).map((b) => ({
      bid_no: b.bid_no, status: b.status, memo: b.memo || null,
      keepA: { checked: b.analysis?.checked, costOff: b.analysis?.costOff, periodMonths: b.analysis?.periodMonths },
    }));
    await supa.from("app_settings").upsert({ key: "reset_backup", value: JSON.stringify({ at: new Date().toISOString(), saved }) });
  }

  // 2) 전부 삭제
  const { error: delErr, count } = await supa.from("bids").delete({ count: "exact" }).neq("key", "");
  if (delErr) return NextResponse.json({ error: `삭제 실패: ${delErr.message}` }, { status: 500 });
  await supa.from("app_settings").delete().eq("key", "rfp_checked");

  // 3) 지정일부터 다시 수집 (이미 받은 알림을 또 보내지 않도록 조용히)
  const run = await runCollect({ hours, quiet: true });

  // 4) 상태 되살리기 (같은 공고번호의 최신 차수에)
  let restored = 0;
  if (keep && saved.length) {
    const { data: now } = await supa.from("bids").select("key, bid_no, analysis").in("bid_no", saved.map((s) => s.bid_no));
    for (const s of saved) {
      const row = (now || []).find((b) => b.bid_no === s.bid_no);
      if (!row) continue;
      const a = row.analysis ? { ...row.analysis, ...Object.fromEntries(Object.entries(s.keepA).filter(([, v]) => v !== undefined)) } : null;
      await supa.from("bids").update({ status: s.status, memo: s.memo, ...(a ? { analysis: a } : {}) }).eq("key", row.key);
      restored++;
    }
  }
  const { count: total } = await supa.from("bids").select("key", { count: "exact", head: true });
  return NextResponse.json({
    삭제: count ?? null, 수집_기간: `${sp.get("from") || "2026-10-01"} ~ 지금 (${hours}시간)`,
    나라장터_조회: run.fetched ?? null, 저장된_공고: total ?? null, 상태_복원: restored, 오류: run.error || null,
    안내: "첨부 분석은 10분마다 자동으로 이어서 진행됩니다. 사이트 맨 아래 '기존 공고 분석 갱신'으로 바로 돌릴 수도 있습니다.",
  });
}
