// AI 호출 공용 — 주 엔진 실패(한도 초과·장애·모델 없음) 시 다음 엔진으로 자동 전환
const GEMINI_MODELS = [...new Set([process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"].filter(Boolean))];
const CLAUDE_MODEL = process.env.ANALYSIS_MODEL || "claude-haiku-4-5-20251001";

export function parseJson(text) {
  const json = String(text).replace(/```json|```/g, "").trim();
  return JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
}

/** Gemini: 모델을 차례로 시도 (404·429·5xx면 다음 모델) */
export async function callGemini(pdfs, prompt, { maxTokens = 4000, temperature = 0.2, models } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 없음");
  const parts = [
    ...(pdfs || []).map((p) => ({ inline_data: { mime_type: "application/pdf", data: p.data } })),
    { text: prompt },
  ];
  const errs = [];
  for (const model of models || GEMINI_MODELS) {
    let res, data;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens, temperature },
        }),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) { errs.push(`${model}: ${e.message}`); continue; }
    if (res.status === 404 || res.status === 429 || res.status >= 500) { errs.push(`${model}: ${res.status} ${String(data?.error?.message || "").slice(0, 80)}`); continue; }
    if (!res.ok) throw new Error(`Gemini 오류 ${res.status}: ${data?.error?.message || ""}`);
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
    try { return parseJson(text); } catch (e) { errs.push(`${model}: JSON 해석 실패 (${cand?.finishReason || "?"}, ${text.length}자)`); continue; }
  }
  throw new Error(`Gemini 응답 없음 (${errs.join(" | ")})`);
}

export async function callClaude(content, { maxTokens = 2500 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 환경변수를 설정하세요.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, temperature: 0, messages: [{ role: "user", content }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI 분석 오류: ${data?.error?.message || res.status}`);
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return parseJson(text);
}

/** 글자 자료만으로 JSON을 받음: Gemini → Claude 순서로 전환 */
export async function askJson(prompt, opts = {}) {
  const errs = [];
  if (process.env.GEMINI_API_KEY) {
    try { return await callGemini([], prompt, opts); } catch (e) { errs.push(e.message); }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try { return await callClaude([{ type: "text", text: prompt }], opts); } catch (e) { errs.push(e.message); }
  }
  throw new Error(errs.join(" / ") || "AI 키 없음");
}
