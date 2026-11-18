// 선별 실행(파일 받기·설정 저장). 판정 규칙은 screen-rules.js
import { db } from "./supabase";
import { fetchFile } from "./fetchfile";
import { hwpText, zippedXmlText, kindOf } from "./doctext";
import { pdfText } from "./pdftext";
import { unzipSync } from "fflate";
import { SIDO_NAMES, findRegionLimit, judge } from "./screen-rules";
export * from "./screen-rules";

/** 우리 회사 정보 (본사 소재지). 기본 서울 */
export async function getCompany() {
  try {
    const { data } = await db().from("app_settings").select("value").eq("key", "company").maybeSingle();
    const v = data?.value ? JSON.parse(data.value) : {};
    return { region: SIDO_NAMES.includes(v.region) ? v.region : "서울" };
  } catch { return { region: "서울" }; }
}
export async function saveCompany(c) {
  const region = SIDO_NAMES.includes(c?.region) ? c.region : "서울";
  const { error } = await db().from("app_settings").upsert({ key: "company", value: JSON.stringify({ region }) }, { onConflict: "key" });
  if (error) throw error;
  return { region };
}

/* ───────── 수집 직후 선별: 공고문만 빠르게 읽어 지역 제한 확인 ───────── */

async function quickText(name, buf, depth = 0) {
  const kind = kindOf(name, buf);
  try {
    if (kind === "hwp") return hwpText(buf);
    if (kind === "hwpx" || kind === "docx") return zippedXmlText(buf, kind);
    if (kind === "pdf") return await pdfText(buf);
    if (kind === "zip" && depth === 0) {
      const inner = unzipSync(new Uint8Array(buf));
      const parts = [];
      for (const [n, d] of Object.entries(inner)) {
        if (!/(공고|제안\s*요청|안내|과업)/.test(n) || !/\.(pdf|hwpx?|docx)$/i.test(n) || parts.length >= 3) continue;
        parts.push(await quickText(n, Buffer.from(d), 1));
      }
      return parts.join("\n");
    }
  } catch {}
  return "";
}

const docRank = (f) => (/입찰\s*공고|공고문|공고서/.test(f.name) ? 0 : /제안\s*요청|사업\s*안내|과업/.test(f.name) ? 1 : /공고/.test(f.name) ? 2 : 3);

/** 공고 1건 선별 → judge 결과 (근거 없으면 null). timeoutMs 안에서만 */
export async function prescreen(row, company, { timeoutMs = 20000 } = {}) {
  const end = Date.now() + timeoutMs;
  let limit = null;
  const files = [...(row.files || [])].filter((f) => f?.url).sort((a, b) => docRank(a) - docRank(b)).slice(0, 3);
  for (const f of files) {
    if (Date.now() > end) break;
    try {
      const res = await Promise.race([fetchFile(f.url), new Promise((r) => setTimeout(() => r(null), Math.max(1000, end - Date.now())))]);
      if (!res) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 25e6) continue;
      const text = await quickText(f.name || "", buf);
      limit = findRegionLimit([{ name: f.name, text }]);
      if (limit) break;
    } catch {}
  }
  return judge({ apiRegions: row._region ?? row.region ?? null, limit, company });
}

export const excludeMemo = (j) => `불참 사유: 자동 제외 · ${j.item} (${j.detail})`;
