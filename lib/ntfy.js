import { pushAll } from "./webpush";

async function sendNtfyOnly({ topic, title, message, url, fileUrl, bidKey, tags, priority = 4 }) {
  const server = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const body = {
    topic,
    title: String(title).slice(0, 250),
    message,
    tags: tags && tags.length ? tags : ["bell"],
    priority,
  };
  const actions = [];
  if (url) {
    body.click = url;
    actions.push({ action: "view", label: "공고 열기", url });
  }
  if (fileUrl) actions.push({ action: "view", label: "공고문 받기", url: fileUrl });
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  if (site) {
    // 사이트에서 이 공고를 바로 펼쳐 분석 내용을 보여 줌
    const view = bidKey ? `${site}/?bid=${encodeURIComponent(bidKey)}` : site;
    actions.push({ action: "view", label: bidKey ? "분석 보기" : "알림판", url: view });
  }
  if (actions.length) body.actions = actions;

  const headers = { "Content-Type": "application/json" };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  const res = await fetch(server + "/", { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
}

/** 알림 보내기: ntfy + 웹 푸시 동시에 */
export async function sendNtfy(opts) {
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const open = opts.bidKey ? `${site}/?bid=${encodeURIComponent(opts.bidKey)}` : site || "/";
  const [nt, wp] = await Promise.allSettled([
    sendNtfyOnly(opts),
    pushAll({ title: String(opts.title).slice(0, 120), body: opts.message || "", url: open, tag: opts.bidKey || undefined }),
  ]);
  if (wp.status === "rejected") console.error("웹 푸시 오류", wp.reason);
  if (nt.status === "rejected" && !(wp.status === "fulfilled" && wp.value > 0)) throw nt.reason;
}
