import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getSettings } from "@/lib/keywords";
import { sendNtfy } from "@/lib/ntfy";
import { fetchBids, toRow } from "@/lib/g2b";

export const dynamic = "force-dynamic";

/**
 * 알림 테스트용 가짜 공고
 *  만들기: /api/test-bid?key=CRON_SECRET
 *  실제 공고 1건으로: /api/test-bid?key=CRON_SECRET&real=1
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

  // 이전 테스트 공고는 지우고 새로 1건만 만듦
  await supa.from("bids").delete().like("key", "TEST-%");

  const settings = await getSettings();
  const now = Date.now();
  const site = (process.env.SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
  const proxy = (f, detail) =>
    `${site}/api/file?u=${encodeURIComponent(f.url)}&n=${encodeURIComponent(f.name)}&d=${encodeURIComponent(detail)}`;

  // 키워드와 상관없는 실제 공고 1건 (첨부파일이 있는 최근 용역 공고)
  if (q.get("real")) {
    let items;
    try {
      items = await fetchBids(24);
    } catch (e) {
      return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
    }
    const rows = items.map(toRow).filter((r) => r.files.length);
    const pick =
      rows.find((r) => r.files.some((f) => /\.(pdf|hwpx?)$/i.test(f.name)) && r.close_at && new Date(r.close_at) > new Date()) ||
      rows[0];
    if (!pick) return NextResponse.json({ error: "최근 24시간 공고 중 첨부파일이 있는 공고를 찾지 못했습니다." }, { status: 404 });

    const real = {
      ...pick,
      key: `TEST-${pick.key}`,
      title: `[테스트] ${pick.title}`,
      matched_rules: ["키워드"],
      keywords: ["테스트용 실제 공고"],
      notified_rule_ids: [settings.id],
      status: "new",
      analysis: null,
    };
    const { error: e1 } = await supa.from("bids").insert(real);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    try {
      await sendNtfy({
        topic: settings.topic,
        title: real.title,
        message: [
          `발주: ${real.org || "-"}`,
          `추정가격: ${real.price ? real.price.toLocaleString("ko-KR") + "원" : "미공개"}`,
          `공고번호: ${pick.key}`,
          `첨부파일: ${real.files.length}개`,
        ].join("\n"),
        url: real.url,
        bidKey: real.key,
        fileUrl: proxy(real.files[0], real.url),
      });
    } catch (e) {
      return NextResponse.json({ ok: false, message: "공고는 넣었지만 알림을 보내지 못했습니다.", error: String(e.message || e) }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      message: "실제 공고 1건을 테스트로 넣고 알림을 보냈습니다. 알림의 [분석 보기]를 누르거나 사이트를 새로고침해 보세요.",
      title: pick.title,
      files: real.files.map((f) => f.name),
      topic: settings.topic,
    });
  }
  const sample = { name: "[샘플] 제안요청서_직무교육 이러닝 콘텐츠 개발.pdf", url: `${site}/sample/rfp-sample.pdf` };
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
    files: [sample],
    analysis: null, // 사이트를 열면 샘플 제안요청서를 읽어 실제와 같은 방식으로 분석
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
      bidKey: row.key,
      fileUrl: `${site}/api/file?u=${encodeURIComponent(sample.url)}&n=${encodeURIComponent(sample.name)}&d=${encodeURIComponent(row.url)}`,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: "공고는 만들었지만 알림을 보내지 못했습니다.", error: String(e.message || e) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    message: "테스트 공고를 만들고 휴대폰으로 알림을 보냈습니다. 알림의 [분석 보기]를 누르거나 사이트를 새로고침해 보세요.",
    topic: settings.topic,
  });
}
