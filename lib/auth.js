export const COOKIE = "g2b_session";

export async function sessionToken() {
  const data = new TextEncoder().encode("g2b-alert:" + (process.env.SITE_PASSWORD || ""));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isLoggedIn(req) {
  if (!process.env.SITE_PASSWORD) return false;
  const value = req.cookies.get(COOKIE)?.value;
  return !!value && value === (await sessionToken());
}
