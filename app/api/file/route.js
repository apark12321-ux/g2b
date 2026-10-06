import { NextResponse } from "next/server";
import { allowedHost, fetchFile, extFromDisposition } from "@/lib/fetchfile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** /api/file?u=원래주소&n=파일이름&d=공고상세주소 */
export async function GET(req) {
  const q = req.nextUrl.searchParams;
  const raw = q.get("u") || "";
  const name = (q.get("n") || "첨부파일").replace(/[\\/:*?"<>|]/g, "_");
  const detail = q.get("d") || "https://www.g2b.go.kr";

  let host = "";
  try { host = new URL(raw.replace(/\s+/g, "")).hostname; } catch { return NextResponse.redirect(detail); }
  if (!allowedHost(host)) return NextResponse.redirect(raw);

  const res = await fetchFile(raw);
  if (!res) return NextResponse.redirect(detail);

  let filename = name;
  if (!/\.[a-z0-9]{2,5}$/i.test(filename)) {
    const ext = extFromDisposition(res.headers.get("content-disposition"));
    if (ext) filename += "." + ext;
  }
  const headers = new Headers();
  headers.set("Content-Type", res.headers.get("content-type") || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  const len = res.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(res.body, { status: 200, headers });
}
