import { sendNtfy } from "./ntfy";
import { isRevised } from "./g2b";

const won = (n) => (n ? `${n.toLocaleString("ko-KR")}원` : "미공개");
const kst = (iso) =>
  iso
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit",
        weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso))
    : "-";

/** 공고 1건 휴대폰 알림 */
export async function notifyBid(row, topic, { hits = [], line } = {}) {
  const org = row.org || "-";
  const demand = row.demand_org && row.demand_org !== org ? ` (수요: ${row.demand_org})` : "";
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const f = (row.files || [])[0];
  await sendNtfy({
    topic,
    title: (isRevised(row.bid_ord) ? "[정정] " : "") + row.title,
    message: [
      line,
      `발주: ${org}${demand}`,
      `추정가격: ${won(row.price)}`,
      `입찰마감: ${kst(row.close_at)}`,
      hits.length ? `키워드: ${hits.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
    url: row.url,
    fileUrl: f && site ? `${site}/api/file?u=${encodeURIComponent(f.url)}&n=${encodeURIComponent(f.name)}&d=${encodeURIComponent(row.url)}` : f?.url,
    bidKey: row.key,
  });
}
