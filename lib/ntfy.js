export async function sendNtfy({ topic, title, message, url, tags, priority = 4 }) {
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
  if (process.env.SITE_URL) actions.push({ action: "view", label: "알림판", url: process.env.SITE_URL });
  if (actions.length) body.actions = actions;

  const headers = { "Content-Type": "application/json" };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  const res = await fetch(server + "/", { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
}
