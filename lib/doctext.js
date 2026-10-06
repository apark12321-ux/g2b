// 첨부파일에서 글자 뽑기: HWP, HWPX, DOCX, TXT (PDF는 AI가 직접 읽음)
import CFB from "cfb";
import { unzipSync, strFromU8 } from "fflate";
import zlib from "node:zlib";

const clean = (s) => s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** HWP 5.0 본문 추출 */
export function hwpText(buf) {
  const cfb = CFB.read(Buffer.from(buf), { type: "buffer" });
  const header = CFB.find(cfb, "FileHeader");
  if (!header) throw new Error("HWP 형식이 아닙니다");
  const props = Buffer.from(header.content).readUInt32LE(36);
  const compressed = (props & 1) === 1;
  const distributed = (props & 4) === 4;

  const sections = cfb.FullPaths
    .map((p, i) => ({ p, e: cfb.FileIndex[i] }))
    .filter(({ p }) => /\/BodyText\/Section\d+$/i.test(p))
    .sort((a, b) => Number(a.p.match(/(\d+)$/)[1]) - Number(b.p.match(/(\d+)$/)[1]));

  let text = "";
  if (!distributed) {
    for (const { e } of sections) {
      let data = Buffer.from(e.content);
      if (compressed) {
        try { data = zlib.inflateRawSync(data); } catch { continue; }
      }
      text += recordsText(data) + "\n";
    }
  }
  if (!text.trim()) {
    // 배포용 문서 등: 미리보기 글자라도 사용
    const prv = CFB.find(cfb, "PrvText");
    if (prv) text = Buffer.from(prv.content).toString("utf16le");
  }
  return clean(text);
}

function recordsText(data) {
  let out = "";
  let pos = 0;
  while (pos + 4 <= data.length) {
    const h = data.readUInt32LE(pos);
    pos += 4;
    const tag = h & 0x3ff;
    let size = (h >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (pos + 4 > data.length) break;
      size = data.readUInt32LE(pos);
      pos += 4;
    }
    if (tag === 67) out += paraText(data.subarray(pos, pos + size)) + "\n"; // HWPTAG_PARA_TEXT
    pos += size;
  }
  return out;
}

// 1글자짜리 제어문자 외에는 8글자(16바이트) 단위로 건너뜀
const SINGLE = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
function paraText(b) {
  let s = "";
  for (let i = 0; i + 1 < b.length; ) {
    const c = b.readUInt16LE(i);
    if (c < 32) {
      if (c === 13 || c === 10) s += "\n";
      else if (c === 9) s += "\t";
      i += SINGLE.has(c) ? 2 : 16;
      continue;
    }
    s += String.fromCharCode(c);
    i += 2;
  }
  return s;
}

/** HWPX / DOCX (압축된 XML 문서) */
export function zippedXmlText(buf, kind) {
  const files = unzipSync(new Uint8Array(buf));
  const names = Object.keys(files)
    .filter((n) => (kind === "hwpx" ? /^Contents\/section\d+\.xml$/i.test(n) : /^word\/document\.xml$/i.test(n)))
    .sort((a, b) => (Number(a.match(/(\d+)/)?.[1]) || 0) - (Number(b.match(/(\d+)/)?.[1]) || 0));
  let text = "";
  for (const n of names) {
    const xml = strFromU8(files[n]);
    text += xml
      .replace(/<\/(hp:p|w:p)>/g, "\n")
      .replace(/<(hp:tab|w:tab)[^>]*\/>/g, "\t")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&") + "\n";
  }
  return clean(text);
}

/** 파일 종류 판별: 확장자 + 내용 앞부분 */
export function kindOf(name, buf) {
  const b = Buffer.from(buf.slice(0, 8));
  const ext = (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  if (b.subarray(0, 4).toString() === "%PDF") return "pdf";
  if (b[0] === 0xd0 && b[1] === 0xcf) return ext === "hwp" || !ext ? "hwp" : ext; // OLE 문서
  if (b[0] === 0x50 && b[1] === 0x4b) return ext === "docx" ? "docx" : ext === "hwpx" ? "hwpx" : ext || "zip";
  return ext;
}
