import { db } from "./supabase";
import { fetchFile } from "./fetchfile";
import { hwpText, zippedXmlText, kindOf } from "./doctext";
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { parseCostSheet } from "./costsheet";
import { pdfText } from "./pdftext";
import { basicExtract } from "./basic-extract";
import { refreshFiles } from "./refresh-files";
import { fillGaps } from "./fill-gaps";
import { fetchBidByNo, fetchRfpFiles, mergeRfp } from "./g2b";
import { videoProfile } from "./video-score";
import { riskReview } from "./risk";
import { notifyBid } from "./notify";
import { getSettings } from "./keywords";
import { tooClose, SKIP_DAYS } from "./watch-words";

const CLAUDE_MODEL = process.env.ANALYSIS_MODEL || "claude-haiku-4-5-20251001";
const GEMINI_MODELS = [process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"].filter(Boolean);
const MAX_FILES = 8;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT = 120000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;


/** 첨부파일을 받아 AI에게 넘길 자료로 만든다 */
async function collectMaterials(files, deadline = Date.now() + 35000) {
  const texts = [];
  const pdfs = [];
  const pdfTexts = []; // AI 없이 뽑을 때 사용
  const skipped = [];
  const status = []; // 파일별 읽기 결과 (화면에 표시)
  let pdfBytes = 0;

  // 공고문·제안요청서·과업지시서를 먼저 읽도록 정렬
  const score = (f) => (f.rfp || /제안\s*요청/.test(f.name) ? -1 : /과업|지시|규격|명세|산출|내역|원가/.test(f.name) ? 0 : /공고/.test(f.name) ? 1 : /설명|안내|요약/.test(f.name) ? 2 : 3);
  const list = [...files].sort((a, b) => score(a) - score(b)).slice(0, MAX_FILES);

  // 파일 1개(또는 압축 안의 파일)를 읽어 글자로
  async function readOne(name, buf) {
    const kind = kindOf(name, buf);
    if (kind === "pdf") {
      let t = "";
      try { t = await pdfText(buf); } catch {}
      if (pdfBytes + buf.length <= MAX_PDF_BYTES) { pdfBytes += buf.length; pdfs.push({ name, data: buf.toString("base64") }); }
      if (t && t.replace(/\s/g, "").length > 50) { pdfTexts.push({ name, text: t }); return ["읽음", t.length]; }
      return ["스캔 이미지(글자 없음)", 0];
    }
    if (kind === "hwp") { const t = hwpText(buf); texts.push({ name, text: t }); return [t ? "읽음" : "글자 없음", t.length]; }
    if (kind === "hwpx" || kind === "docx") { const t = zippedXmlText(buf, kind); texts.push({ name, text: t }); return [t ? "읽음" : "글자 없음", t.length]; }
    if (kind === "txt") { const t = buf.toString("utf8"); texts.push({ name, text: t }); return ["읽음", t.length]; }
    if (kind === "xlsx" || kind === "xls") {
      // 엑셀(산출내역서·과업내역서): 행마다 칸을 탭으로 이어 글자로
      const wb = XLSX.read(buf, { type: "buffer" });
      const t = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "\t", blankrows: false })).join("\n");
      texts.push({ name, text: t });
      return [t ? "읽음" : "글자 없음", t.length];
    }
    if (kind === "zip") {
      // 압축 파일 안의 문서도 읽음
      const inner = unzipSync(new Uint8Array(buf));
      let n = 0, chars = 0;
      for (const [iname, data] of Object.entries(inner)) {
        if (!/\.(pdf|hwpx?|docx|txt|xlsx?)$/i.test(iname) || n >= 6) continue;
        const r = await readOne(`${name} › ${iname.split("/").pop()}`, Buffer.from(data));
        if (r[0] === "읽음") { n++; chars += r[1]; }
      }
      return [n ? `압축 안 ${n}개 읽음` : "압축 안에 읽을 문서 없음", chars];
    }
    return ["지원하지 않는 형식", 0];
  }

  for (const f of list) {
    if (Date.now() > deadline) { status.push({ name: f.name, status: "시간 초과로 건너뜀" }); continue; }
    try {
      const res = await fetchFile(f.url);
      if (!res) { skipped.push(`${f.name}(받기 실패)`); status.push({ name: f.name, status: "받기 실패" }); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_FILE_BYTES) { skipped.push(`${f.name}(용량 초과)`); status.push({ name: f.name, status: "용량 초과" }); continue; }
      const [st, chars] = await readOne(f.name, buf);
      status.push({ name: f.name, status: st, chars });
      if (!/읽음/.test(st)) skipped.push(`${f.name}(${st})`);
    } catch {
      skipped.push(`${f.name}(읽기 실패)`);
      status.push({ name: f.name, status: "읽기 실패" });
    }
  }
  if (files.length > MAX_FILES) status.push({ name: `그 외 ${files.length - MAX_FILES}개`, status: "읽지 않음(개수 제한)" });

  // 글자 수 제한
  let budget = MAX_TEXT;
  for (const t of texts) {
    t.text = t.text.slice(0, Math.max(0, budget));
    budget -= t.text.length;
  }
  return { texts: texts.filter((t) => t.text), pdfs, pdfTexts, skipped, status };
}

const PROMPT = (bid, texts, skipped) => `당신은 공공 입찰 분석가입니다. 아래 나라장터 용역 입찰공고와 첨부 문서를 읽고, 입찰 참여 여부를 판단하는 실무자를 위해 한국어로 분석하세요.

[공고 정보]
공고명: ${bid.title}
공고기관: ${bid.org || "-"} / 수요기관: ${bid.demand_org || "-"}
추정가격: ${bid.price ? bid.price.toLocaleString("ko-KR") + "원" : "미공개"}
입찰마감: ${bid.close_at || "-"}
${skipped.length ? `읽지 못한 첨부: ${skipped.join(", ")}` : ""}

${texts.map((t) => `[첨부: ${t.name}]\n${t.text}`).join("\n\n")}

리스크는 계약 일반조건(무상 수정, 업종 등록, 지체상금, 하자보수 등 공공용역에 늘 붙는 조항)은 빼고, 이 사업만의 실질적 위험을 찾으세요: 예산 대비 과업량, 실제 필요 인력과 기간의 부담, 촬영·출연·장소 등 숨은 비용, 발주처 요구 수준(품질·검수 횟수), 지역 제한, 실적 요건, 현장설명회 의무, 하도급 금지, 상주, 가격 경쟁 비중 등.
다음 JSON 형식으로만 답하세요. 설명이나 코드블록 표시는 붙이지 마세요. 문서에 없는 내용은 추측하지 말고 "문서에 없음"이라고 쓰세요.
{
  "summary": "이 사업에서 실제로 무엇을 만들거나 하는지 1문장 (예: 직무교육 이러닝 60차시를 기획·촬영·개발해 LMS에 탑재)",
  "tasks": ["실제로 해야 하는 일을 짧고 구체적으로, 중요한 순서대로 최대 6개"],
  "deliverables": ["최종 납품 결과물을 수량·규격과 함께 정확히 (예: 이러닝 콘텐츠 60차시(차시당 25분), 스토리보드 6종)"],
  "video_share": "전체 과업 중 영상 기획·촬영·편집·제작이 차지하는 비중 추정치 0~100 숫자",
  "has_isd": "교수설계(학습 설계·스토리보드 등)가 과업에 포함되면 true",
  "has_video": "영상 제작(촬영·편집·영상 콘텐츠 개발)이 과업에 포함되면 true",
  "staff": [{"role": "필요 인력 역할", "detail": "인원·자격·경력 요건"}],
  "period": "사업 기간",
  "eligibility": ["참가 자격 요건 (업종 코드, 실적, 지역 제한 등)"],
  "evaluation": "낙찰자 결정 방식 (협상·적격심사, 기술:가격 비율 등)",
  "schedule": ["제안서 제출·설명회 등 주요 일정"],
  "presentation": ["제안 발표 관련 조건을 원문에 가깝게 빠짐없이: 발표자 자격(사업책임자·PM 직접 발표 여부, 대리 발표 허용 여부), 발표 시간, 질의응답 시간, 발표 일시·장소·방식(대면/비대면), 발표 자료 제한, 참석 인원 등. 문서에 없으면 빈 배열"],
  "cautions": ["놓치기 쉬운 유의사항"],
  "risks": [{"level": "높음 | 주의 | 참고", "item": "입찰·수행 리스크 이름", "detail": "근거 문장"}],
  "verdict": {"level": "입찰 검토 권장 | 조건 확인 후 입찰 | 무리한 입찰 주의", "reason": "판단 이유 1~2문장"},
  "checklist": ["입찰 전에 우리 회사가 확인해야 할 것"]
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
  // 제안요청서(별도 API)가 첨부에 없으면 가져와서 맨 앞에 붙임 — 가장 중요한 문서
  if (!String(key).startsWith("TEST-") && !(bid.files || []).some((f) => f.rfp)) {
    try {
      const rfps = await fetchRfpFiles(bid.bid_no, bid.bid_ord);
      if (rfps.length) {
        bid.files = mergeRfp(bid.files, rfps);
        await supa.from("bids").update({ files: bid.files }).eq("key", key);
        if (bid.analysis && !(bid.analysis.fileStatus || []).some((x) => /제안\s*요청/.test(x.name) && /읽음/.test(x.status))) force = true;
      }
    } catch {}
  }
  // 이미 분석됨 (영상 비중 판정이 없는 예전 분석은 다시 함)
  if (bid.analysis && bid.analysis.video && bid.analysis.review && bid.analysis.fileStatus && (bid.analysis.ver || 0) >= 5 && !force) return { ...bid.analysis, _files: bid.files };

  // 나라장터 공고 원본 (평가방식·일정·설명회 등) — 문서를 못 읽어도 채울 수 있음
  let meta = null;
  try { meta = await fetchBidByNo(bid.bid_no, bid.bid_ord); } catch {}

  let texts = [], pdfs = [], pdfTexts = [], skipped = [], status = [];
  try {
    ({ texts, pdfs, pdfTexts, skipped, status } = await collectMaterials(bid.files || []));
  } catch (e) {
    status = [{ name: "첨부 전체", status: "읽기 오류" }];
  }
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
    try { result = basicExtract([...texts, ...pdfTexts], bid); } catch { result = { mode: "basic" }; }
  }
  const allText = [...texts, ...pdfTexts].map((t) => t.text).join("\n");
  fillGaps(result, bid, meta, allText); // 빈 항목은 공고 정보·공고명으로 채움 (발표자는 문서 전체에서)
  result.sources = [...texts.map((t) => t.name), ...pdfTexts.map((p) => p.name)];
  result.skipped = skipped;
  result.fileStatus = status;
  if (typeof result.video_share === "string") result.video_share = Number(result.video_share);
  const docText = [...texts, ...pdfTexts].map((t) => t.text).join("\n");
  try { result.costSheet = parseCostSheet(docText); } catch {}
  result.ver = 5; // 추출 방식 버전 (올리면 예전 분석은 다시 함)
  result.video = videoProfile(bid, docText, result);
  // 리스크 점검: 규칙 점검 결과에 AI가 찾은 리스크를 합침
  let rv;
  try { rv = riskReview(bid, docText, result); }
  catch { rv = { verdict: { level: "조건 확인 후 입찰", tone: "warn", reason: "자동 점검 일부 실패" }, risks: [], unit: null, checklist: [] }; }
  const aiRisks = Array.isArray(result.risks) ? result.risks.filter((r) => r && r.item) : [];
  const merged = [...rv.risks];
  for (const r of aiRisks.filter((x) => !/직접\s*생산/.test(`${x.item} ${x.detail || ""}`))) if (!merged.some((m) => m.item === r.item)) merged.push({ level: r.level || "참고", item: r.item, detail: r.detail || "" });
  const order = { 높음: 0, 주의: 1, 참고: 2 };
  merged.sort((x, y) => (order[x.level] ?? 2) - (order[y.level] ?? 2));
  const tones = { "입찰 검토 권장": "good", "조건 확인 후 입찰": "warn", "무리한 입찰 주의": "bad" };
  // 둘 중 더 보수적인(위험한) 판단을 채택
  const aiV = result.verdict?.level && tones[result.verdict.level] ? { ...result.verdict, tone: tones[result.verdict.level] } : null;
  const rank = { good: 0, warn: 1, bad: 2 };
  result.review = {
    verdict: aiV && rank[aiV.tone] > rank[rv.verdict.tone] ? aiV : rv.verdict,
    risks: merged,
    unit: rv.unit,
    checklist: [...new Set([...(rv.checklist || []), ...((result.checklist || []).filter(Boolean))])],
  };
  delete result.risks; delete result.verdict; delete result.checklist;

  const { error: e2 } = await supa
    .from("bids")
    .update({ analysis: result, analyzed_at: new Date().toISOString() })
    .eq("key", key);
  if (e2) throw new Error(/analysis/.test(e2.message) ? "Supabase에 analysis 칸이 없습니다. 안내된 SQL을 먼저 실행하세요." : e2.message);
  // 공고명만으로는 알림을 미뤘던 공고: 영상 비중이 너무 낮지 않으면 지금 알림
  if (!String(key).startsWith("TEST-") && !(bid.notified_rule_ids || []).length && !result.video.low && !tooClose(bid.close_at)) {
    try {
      const st = await getSettings();
      await notifyBid(bid, st.topic, {
        hits: bid.keywords || [],
        line: result.video.priority ? "교수설계+영상 공고" : "",
      });
      await supa.from("bids").update({ notified_rule_ids: [st.id] }).eq("key", key);
    } catch (e) {
      console.error("분석 후 알림 실패", key, e);
    }
  }
  return { ...result, _files: bid.files };
}

/** 아직 분석 안 된 진행 중 공고를 시간 안에서 몇 건 분석 */
export async function analyzePending(deadlineMs) {
  const { data, error } = await db()
    .from("bids")
    .select("key")
    .is("analysis", null)
    .neq("status", "pass")
    .gt("close_at", new Date(Date.now() + SKIP_DAYS * 864e5).toISOString())
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
