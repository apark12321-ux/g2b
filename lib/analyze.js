import { db } from "./supabase";
import { fetchFile } from "./fetchfile";
import { hwpText, zippedXmlText, kindOf } from "./doctext";
import { pdfText } from "./pdftext";
import { basicExtract } from "./basic-extract";
import { refreshFiles } from "./refresh-files";

const CLAUDE_MODEL = process.env.ANALYSIS_MODEL || "claude-haiku-4-5-20251001";
const GEMINI_MODELS = [process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"].filter(Boolean);
const MAX_FILES = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT = 60000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;


/** 첨부파일을 받아 AI에게 넘길 자료로 만든다 */
async function collectMaterials(files) {
  const texts = [];
  const pdfs = [];
  const pdfTexts = []; // AI 없이 뽑을 때 사용
  const skipped = [];
  let pdfBytes = 0;

  // 공고문·제안요청서·과업지시서를 먼저 읽도록 정렬
  const score = (n) => (/제안요청|과업|공고|규격|명세|지시/.test(n) ? 0 : 1);
  const list = [...files].sort((a, b) => score(a.name) - score(b.name)).slice(0, MAX_FILES);

  for (const f of list) {
    try {
      const res = await fetchFile(f.url);
      if (!res) { skipped.push(`${f.name}(받기 실패)`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_FILE_BYTES) { skipped.push(`${f.name}(용량 초과)`); continue; }
      const kind = kindOf(f.name, buf);
      if (kind === "pdf") {
        if (pdfBytes + buf.length > MAX_PDF_BYTES) { skipped.push(`${f.name}(용량 초과)`); continue; }
        pdfBytes += buf.length;
        pdfs.push({ name: f.name, data: buf.toString("base64") });
        try { const t = await pdfText(buf); if (t) pdfTexts.push({ name: f.name, text: t }); } catch {}
      } else if (kind === "hwp") {
        texts.push({ name: f.name, text: hwpText(buf) });
      } else if (kind === "hwpx" || kind === "docx") {
        texts.push({ name: f.name, text: zippedXmlText(buf, kind) });
      } else if (kind === "txt") {
        texts.push({ name: f.name, text: buf.toString("utf8") });
      } else {
        skipped.push(`${f.name}(읽을 수 없는 형식)`);
      }
    } catch {
      skipped.push(`${f.name}(읽기 실패)`);
    }
  }

  // 글자 수 제한
  let budget = MAX_TEXT;
  for (const t of texts) {
    t.text = t.text.slice(0, Math.max(0, budget));
    budget -= t.text.length;
  }
  return { texts: texts.filter((t) => t.text), pdfs, pdfTexts, skipped };
}

const PROMPT = (bid, texts, skipped) => `당신은 공공 입찰 분석가입니다. 아래 나라장터 용역 입찰공고와 첨부 문서를 읽고, 입찰 참여 여부를 판단하는 실무자를 위해 한국어로 분석하세요.

[공고 정보]
공고명: ${bid.title}
공고기관: ${bid.org || "-"} / 수요기관: ${bid.demand_org || "-"}
추정가격: ${bid.price ? bid.price.toLocaleString("ko-KR") + "원" : "미공개"}
입찰마감: ${bid.close_at || "-"}
${skipped.length ? `읽지 못한 첨부: ${skipped.join(", ")}` : ""}

${texts.map((t) => `[첨부: ${t.name}]\n${t.text}`).join("\n\n")}

다음 JSON 형식으로만 답하세요. 설명이나 코드블록 표시는 붙이지 마세요. 문서에 없는 내용은 추측하지 말고 "문서에 없음"이라고 쓰세요.
{
  "summary": "어떤 사업인지 2~3문장",
  "tasks": ["수행해야 할 주요 업무 (구체적으로)"],
  "deliverables": ["납품물·산출물 (수량 포함)"],
  "staff": [{"role": "필요 인력 역할", "detail": "인원·자격·경력 요건"}],
  "period": "사업 기간",
  "eligibility": ["참가 자격 요건 (업종 코드, 실적, 지역 제한 등)"],
  "evaluation": "낙찰자 결정 방식 (협상·적격심사, 기술:가격 비율 등)",
  "schedule": ["제안서 제출·설명회 등 주요 일정"],
  "cautions": ["놓치기 쉬운 유의사항·리스크"]
}`;

function parseJson(text) {
  const json = String(text).replace(/```json|```/g, "").trim();
  return JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
}

/** 구글 Gemini (무료 키 가능) */
async function callGemini(pdfs, prompt) {
  const key = process.env.GEMINI_API_KEY;
  const parts = [
    ...pdfs.map((p) => ({ inline_data: { mime_type: "application/pdf", data: p.data } })),
    { text: prompt },
  ];
  let last = "";
  for (const model of GEMINI_MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4000, temperature: 0.2 },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) { last = `모델 ${model} 없음`; continue; } // 다음 모델로
    if (!res.ok) throw new Error(`Gemini 오류 ${res.status}: ${data?.error?.message || ""}`);
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    return parseJson(text);
  }
  throw new Error(`Gemini 모델을 찾지 못했습니다 (${last})`);
}

async function callClaude(content) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 환경변수를 설정하세요.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2500, messages: [{ role: "user", content }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI 분석 오류: ${data?.error?.message || res.status}`);
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return parseJson(text);
}

/** 공고 1건 분석 후 저장, 결과 반환 */
export async function analyzeBid(key, { force = false } = {}) {
  const supa = db();
  const { data: bid, error } = await supa.from("bids").select("*").eq("key", key).single();
  if (error) throw error;
  // 첨부 목록이 비어 있으면 먼저 나라장터에서 다시 받아 옴
  try {
    const patch = await refreshFiles(bid);
    if (patch) Object.assign(bid, patch);
  } catch {}
  if (bid.analysis && !force) return { ...bid.analysis, _files: bid.files };

  const { texts, pdfs, pdfTexts, skipped } = await collectMaterials(bid.files || []);
  const prompt = PROMPT(bid, texts, skipped);

  let result = null;
  let aiError = "";
  try {
    if (process.env.GEMINI_API_KEY) {
      result = await callGemini(pdfs, prompt);
      result.mode = "ai";
    } else if (process.env.ANTHROPIC_API_KEY) {
      result = await callClaude([
        ...pdfs.map((p) => ({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: p.data },
          title: p.name,
        })),
        { type: "text", text: prompt },
      ]);
      result.mode = "ai";
    }
  } catch (e) {
    aiError = String(e.message || e); // 한도 초과 등 → 아래에서 규칙 추출로 대신함
    console.error("AI 분석 실패, 규칙 추출로 대체", key, aiError);
  }
  if (!result) {
    result = basicExtract([...texts, ...pdfTexts]);
    if (aiError) result.note = "AI 분석 한도를 넘었거나 오류가 있어 문서에서 직접 뽑았습니다.";
  }
  result.sources = [...texts.map((t) => t.name), ...pdfs.map((p) => p.name)];
  result.skipped = skipped;

  const { error: e2 } = await supa
    .from("bids")
    .update({ analysis: result, analyzed_at: new Date().toISOString() })
    .eq("key", key);
  if (e2) throw new Error(/analysis/.test(e2.message) ? "Supabase에 analysis 칸이 없습니다. 안내된 SQL을 먼저 실행하세요." : e2.message);
  return { ...result, _files: bid.files };
}

/** 아직 분석 안 된 진행 중 공고를 시간 안에서 몇 건 분석 */
export async function analyzePending(deadlineMs) {
  const { data, error } = await db()
    .from("bids")
    .select("key")
    .is("analysis", null)
    .neq("status", "pass")
    .gt("close_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(3);
  if (error || !data) return 0;
  let done = 0;
  for (const { key } of data) {
    if (Date.now() > deadlineMs) break;
    try { await analyzeBid(key); done++; } catch (e) { console.error("자동 분석 실패", key, e); }
  }
  return done;
}
