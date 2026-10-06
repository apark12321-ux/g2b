// 나라장터 등 공공기관 첨부파일을 서버에서 받아 오는 공통 함수
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

const extraHosts = () => (process.env.ALLOW_FILE_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
export const allowedHost = (host) => /\.(go|or|re|ac)\.kr$/i.test(host) || extraHosts().includes(host);

async function tryFetch(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://www.g2b.go.kr/", Accept: "*/*" },
      redirect: "follow",
      cache: "no-store",
    });
    return res.ok && res.body ? res : null;
  } catch {
    return null;
  }
}

/** 파일 응답(Response)을 돌려줌. 파일이 아니거나 실패하면 null */
export async function fetchFile(rawUrl) {
  let target;
  try {
    target = new URL(String(rawUrl).replace(/\s+/g, ""));
  } catch {
    return null;
  }
  if (!allowedHost(target.hostname)) return null;
  let res = null;
  if (target.protocol === "http:") {
    const https = new URL(target);
    https.protocol = "https:";
    res = await tryFetch(https.toString());
  }
  if (!res) res = await tryFetch(target.toString());
  if (!res || /text\/html/i.test(res.headers.get("content-type") || "")) return null;
  return res;
}

export function extFromDisposition(cd) {
  if (!cd) return "";
  const m = cd.match(/\.([a-z0-9]{2,5})["';\s]*$/i) || cd.match(/\.([a-z0-9]{2,5})["';]/i);
  return m ? m[1].toLowerCase() : "";
}
