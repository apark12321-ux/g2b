import { NextResponse } from "next/server";
import { COOKIE, sessionToken } from "@/lib/auth";

export async function POST(req) {
  if (!process.env.SITE_PASSWORD) {
    return NextResponse.json({ error: "서버에 SITE_PASSWORD가 설정되지 않았습니다." }, { status: 500 });
  }
  const { password } = await req.json().catch(() => ({}));
  if (password !== process.env.SITE_PASSWORD) {
    return NextResponse.json({ error: "비밀번호가 맞지 않습니다." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await sessionToken(), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
