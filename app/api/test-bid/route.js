import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getSettings } from "@/lib/keywords";
import { sendNtfy } from "@/lib/ntfy";

export const dynamic = "force-dynamic";

/**
 * 알림 테스트용 가짜 공고
 *  만들기: /api/test-bid?key=CRON_SECRET
 *  지우기: /api/test-bid?key=CRON_SECRET&clear=1
 */
export async function GET(req) {
  const q = req.nextUrl.searchParams;
  if (!process.env.CRON_SECRET || q.get("key") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }
  const supa = db();

  if (q.get("clear")) {
    const { error } = await supa.from("bids").delete().like("key", "TEST-%");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, message: "테스트 공고를 모두 지웠습니다." });
  }

  const settings = await getSettings();
  const now = Date.now();
  const row = {
    key: `TEST-${now}`,
    bid_no: "TEST",
    bid_ord: "000",
    title: "[테스트] 2026년 직무교육 이러닝 콘텐츠 개발 용역",
    org: "테스트기관 (알림 확인용)",
    demand_org: null,
    price: 88000000,
    posted_at: new Date(now).toISOString(),
    close_at: new Date(now + 7 * 864e5).toISOString(),
    url: "https://www.g2b.go.kr",
    matched_rules: ["키워드"],
    keywords: ["이러닝", "콘텐츠 개발"],
    notified_rule_ids: [settings.id],
    status: "new",
    files: [],
    analysis: {
      summary: "알림이 잘 오는지 확인하기 위한 테스트 공고입니다. 실제 공고가 아닙니다.",
      fit: { level: "중", reason: "테스트용 예시입니다." },
      tasks: ["이 칸에 실제 공고의 주요 업무가 표시됩니다."],
      staff: [{ role: "예시 인력", detail: "실제 공고에서는 인원·자격 요건이 표시됩니다." }],
      sources: [],
    },
  };

  let { error } = await supa.from("bids").insert(row);
  if (error && /analysis|files/.test(error.message)) {
    const { analysis, files, ...rest } = row; // 칸을 아직 안 만든 경우
    ({ error } = await supa.from("bids").insert(rest));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await sendNtfy({
      topic: settings.topic,
      title: row.title,
      message: [
        `발주: ${row.org}`,
        `추정가격: ${row.price.toLocaleString("ko-KR")}원`,
        "입찰마감: 7일 뒤",
        "키워드: 이러닝, 콘텐츠 개발",
      ].join("\n"),
      url: row.url,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: "공고는 만들었지만 알림을 보내지 못했습니다.", error: String(e.message || e) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    message: "테스트 공고를 만들고 휴대폰으로 알림을 보냈습니다. 사이트를 새로고침해 보세요.",
    topic: settings.topic,
  });
}
