import { NextResponse } from "next/server";
import { getVapid } from "@/lib/webpush";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { publicKey } = await getVapid();
    return NextResponse.json({ publicKey });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
