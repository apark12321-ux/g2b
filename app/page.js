"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { at, dday, money, when } from "@/components/format";
import { winScore } from "@/lib/score";
import { titleVideoOnly } from "@/lib/video-score";

const TABS = [
  ["all", "전체"],
  ["new", "신규"],
  ["pass", "불참"],
];
const STAMPS = [
  ["review", "검토"],
  ["join", "참여"],
  ["pass", "불참"],
];

// 마감까지 5일 이내 남은 공고 (준비 기간 부족으로 패스)
const SKIP_DAYS = 5;
const soon = (b) => {
  if (!b.close_at) return false;
  const left = new Date(b.close_at).getTime() - Date.now();
  return left > 0 && left < SKIP_DAYS * 864e5; // 이미 마감된 공고는 '마감 지난 공고 숨기기'가 따로 처리
};

export default function Home() {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [tab, setTab] = useState("new"); // "new" 또는 맨 아래 링크로 여는 "pass"
  const [section, setSection] = useState("bids"); // bids: 입찰 공고, review: 검토·분석
  const [rule, setRule] = useState("");
  const [q, setQ] = useState("");
  const [showLow, setShowLow] = useState(false); // 영상 비중 낮은 공고 보기
  const [focus, setFocus] = useState(null);
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("bid");
    if (k) setFocus(k);
  }, []);
  const [collecting, setCollecting] = useState(false);
  const [toast, setToast] = useState(null);

  const say = (text, bad, undo) => {
    setToast({ text, bad, undo });
    clearTimeout(say.t);
    say.t = setTimeout(() => setToast(null), undo ? 6000 : 3500);
  };

  const load = useCallback(async () => {
    try {
      setData(await api("/api/bids"));
      setLoadErr("");
    } catch (e) {
      setLoadErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const collect = async () => {
    setCollecting(true);
    try {
      const r = await api("/api/collect", { method: "POST" });
      if (r.failed) say(`새 공고 알림 ${r.failed}건을 보내지 못했습니다. 휴대폰 알림 채널 이름을 확인하세요.`, true);
      else if (r.sent) say(`새 관련 공고 ${r.sent}건을 휴대폰으로 알렸습니다.`);
      else say(`공고 ${r.fetched}건을 확인했고, 새로 올라온 관련 공고는 없습니다.`);
      await load();
    } catch (e) {
      say(e.message, true);
      await load();
    } finally {
      setCollecting(false);
    }
  };

  const setAnalysis = (key, res) => {
    const { _files, ...analysis } = res || {};
    setData((d) => ({
      ...d,
      bids: d.bids.map((b) => (b.key === key ? { ...b, analysis, ...(_files ? { files: _files } : {}) } : b)),
    }));
  };

  // 분석이 없는 진행 중 공고를 화면이 열려 있는 동안 하나씩 자동 분석
  const [working, setWorking] = useState(null);
  const [failed, setFailed] = useState({});
  const [tried, setTried] = useState({}); // 이번 접속에서 이미 확인한 공고
  const analyze = useCallback(async (key, force = false) => {
    setWorking(key);
    setTried((t) => ({ ...t, [key]: true }));
    setFailed((f) => { const n = { ...f }; delete n[key]; return n; });
    try {
      const a = await api("/api/analyze", { method: "POST", body: JSON.stringify({ key, force }) });
      setAnalysis(key, a);
    } catch (e) {
      setFailed((f) => ({ ...f, [key]: e.message }));
    } finally {
      setWorking(null);
    }
  }, []);
  useEffect(() => {
    if (!data || working) return;
    const now = Date.now();
    // 분석이 없거나, 첨부 목록이 비어 있는(다시 받아 올) 공고
    const needs = (b) =>
      !tried[b.key] && !failed[b.key] && (b.status === "review" || b.status === "join" || focus === b.key) &&
      (!b.analysis || !b.analysis.review || !(b.files || []).length);
    const want = focus && data.bids.find((b) => b.key === focus && needs(b));
    const next = want || data.bids.find(
      (b) => needs(b) && b.status !== "pass" && (!b.close_at || new Date(b.close_at).getTime() > now)
    );
    if (next) analyze(next.key);
  }, [data, working, failed, tried, analyze, focus]);

  // 알림에서 연 공고로 이동
  useEffect(() => {
    if (!focus || !data) return;
    const b = data.bids.find((x) => x.key === focus);
    if (!b) return;
    setSection(b.status === "review" ? "review" : b.status === "join" ? "join" : "bids");
    if (b.close_at && new Date(b.close_at).getTime() < Date.now()) setHideClosed(false);
    setTimeout(() => document.getElementById(`bid-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
  }, [focus, data?.bids?.length]);

  const update = async (key, patch) => {
    setData((d) => ({ ...d, bids: d.bids.map((b) => (b.key === key ? { ...b, ...patch } : b)) }));
    try {
      await api(`/api/bids/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (e) {
      say(`저장하지 못했습니다: ${e.message}`, true);
      load();
    }
  };

  const base = useMemo(() => {
    if (!data) return [];
    // 띄어쓰기 무시, 여러 단어는 모두 포함된 공고만
    const nz = (x) => String(x || "").toLowerCase().replace(/\s+/g, "");
    const words = q.trim().split(/\s+/).filter(Boolean).map(nz);
    const now = Date.now();
    const list = data.bids.filter(
      (b) =>
        (!rule || b.matched_rules.includes(rule)) &&
        (showLow || focus === b.key || !b.analysis?.video?.low) &&
        (focus === b.key || !soon(b)) &&
        (b.status === "join" || !b.close_at || new Date(b.close_at).getTime() > now) && // 마감 지난 공고는 표시 안 함 (참여 제외)
        (!words.length || words.every((w) => nz(`${b.title}${b.org || ""}${b.demand_org || ""}`).includes(w)))
    );
    // 교수설계+영상 공고를 맨 위로
    const p = (b) => ((b.analysis?.video?.only ?? titleVideoOnly(b.title)) ? 0 : b.analysis?.video?.priority ? 1 : 2);
    return list.map((b, i) => [b, i]).sort((x, y) => p(x[0]) - p(y[0]) || x[1] - y[1]).map((x) => x[0]);
  }, [data, rule, q, showLow, focus]);
  const lowCount = useMemo(() => (data ? data.bids.filter((b) => b.analysis?.video?.low).length : 0), [data]);

  // 검토로 넘긴 공고는 '입찰 공고' 쪽(전체·신규 등)에서 빼고 '검토·분석'에서만 보임
  const bidsOnly = useMemo(
    () => base.filter((b) => b.status === "new"), // 검토·참여로 넘긴 공고, 불참(패스) 공고는 제외
    [base]
  );
  const counts = useMemo(() => {
    const c = { all: bidsOnly.length, new: 0, review: 0, join: 0, pass: 0 };
    bidsOnly.forEach((b) => c[b.status]++);
    return c;
  }, [bidsOnly]);

  const reviewList = base
    .filter((b) => b.status === "review")
    .map((b) => [b, winScore(b, b.analysis)?.score ?? -1])
    .sort((x, y) => y[1] - x[1])
    .map((x) => x[0]);
  const joinList = base.filter((b) => b.status === "join");
  const shown =
    section === "review" ? reviewList :
    section === "join" ? joinList :
    bidsOnly.filter((b) => b.status === "new");
  const run = data?.lastRun;

  return (
    <>
      <div className="top">
        <div>
          <div className="sections" role="tablist">
            <button role="tab" aria-selected={section === "bids"} className={section === "bids" ? "on" : ""} onClick={() => setSection("bids")}>
              입찰 공고
            </button>
            <button role="tab" aria-selected={section === "review"} className={section === "review" ? "on" : ""} onClick={() => setSection("review")}>
              검토·분석{reviewList.length > 0 && <span className="sec-n">{reviewList.length}</span>}
            </button>
            <button role="tab" aria-selected={section === "join"} className={section === "join" ? "on" : ""} onClick={() => setSection("join")}>
              참여{joinList.length > 0 && <span className="sec-n join">{joinList.length}</span>}
            </button>
          </div>
          {run && (
            <div className={`run ${run.error ? "bad" : ""}`}>
              {run.error
                ? `마지막 수집 실패 (${at(run.ran_at)}): ${run.error}`
                : `마지막 수집 ${at(run.ran_at)}, 공고 ${run.fetched}건 확인, 새 알림 ${run.sent}건${run.failed ? `, 알림 실패 ${run.failed}건` : ""}`}
            </div>
          )}
        </div>
      </div>



      <div className="filters">
        <input className="field search" type="search" placeholder="모인 공고에서 찾기 (공고명·기관)" value={q} onChange={(e) => setQ(e.target.value)} />

      </div>

      {loadErr && <div className="empty"><strong>목록을 불러오지 못했습니다</strong>{loadErr}</div>}
      {!data && !loadErr && <div className="empty">불러오는 중</div>}

      {data && !shown.length && (
        <div className="empty">
          {section === "join" ? (
            <><strong>참여하기로 한 공고가 없습니다</strong>검토·분석에서 <b>참여</b>를 누르면 여기로 옮겨집니다.</>
          ) : section === "review" ? (
            <><strong>검토 중인 공고가 없습니다</strong>입찰 공고에서 <b>검토</b>를 누르면 여기서 리스크 분석을 볼 수 있습니다.</>
          ) : data.bids.length ? (
            <><strong>조건에 맞는 공고가 없습니다</strong>필터를 바꾸거나 마감 지난 공고도 표시해 보세요.</>
          ) : (
            <><strong>아직 모인 공고가 없습니다</strong>10분마다 자동으로 수집합니다. 잠시 후 다시 확인해 주세요.</>
          )}
        </div>
      )}

      {lowCount > 0 && (
        <div className="low-toggle">
          영상 비중이 낮은 공고 {lowCount}건을 {showLow ? "함께 보고 있습니다." : "숨겼습니다."}
          <button className="mini" onClick={() => setShowLow(!showLow)}>{showLow ? "다시 숨기기" : "보기"}</button>
        </div>
      )}

      <div className="list">
        {shown.map((b) => (section === "review" || section === "join") ? <ReportCard key={b.key} bid={b} onUpdate={update} focused={focus === b.key} section={section} say={say}
            an={{ working: working === b.key, error: failed[b.key], retry: (force) => analyze(b.key, force) }} /> : <BidRow key={b.key} bid={b} onUpdate={update} focused={focus === b.key} detail={false} section={section} say={say}
            an={{ working: working === b.key, error: failed[b.key], retry: (force) => analyze(b.key, force) }} />)}
      </div>

      <footer className="page-foot">
        <Subscribe say={say} />
        10분마다 자동으로 수집합니다.
        <button className="foot-link" onClick={collect} disabled={collecting}>{collecting ? "수집 중" : "수동 수집"}</button>
      </footer>

      {toast && (
        <div className={`toast ${toast.bad ? "bad" : ""}`} role="status">
          {toast.text}
          {toast.undo && <button className="toast-undo" onClick={() => { toast.undo(); setToast(null); }}>되돌리기</button>}
        </div>
      )}
    </>
  );
}

function b64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** 알림 받기 ON/OFF (이 기기) */
function DevicePush({ say }) {
  const [state, setState] = useState("checking"); // checking | unsupported | ios | denied | off | on
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState(ios && !standalone ? "ios" : "unsupported");
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const turnOn = async () => {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
    const { publicKey } = await api("/api/push/key");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ sub: sub.toJSON() }) });
    setState("on");
    say("알림을 켰습니다.");
  };
  const turnOff = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
    say("알림을 껐습니다.");
  };
  const toggle = async () => {
    setBusy(true);
    try { state === "on" ? await turnOff() : await turnOn(); }
    catch (e) { say(`설정하지 못했습니다: ${e.message}`, true); }
    finally { setBusy(false); }
  };

  const can = state === "on" || state === "off";
  return (
    <div className="push-box">
      <div className="push-row">
        <b>알림 받기</b>
        <button
          className={`toggle ${state === "on" ? "is-on" : ""}`} role="switch" aria-checked={state === "on"}
          onClick={toggle} disabled={!can || busy}
        >
          <span className="knob" />
          <span className="tlabel">{state === "on" ? "ON" : "OFF"}</span>
        </button>
      </div>
      {state === "ios" && <p>아이폰은 아래 방법으로 앱을 설치한 뒤, 앱에서 켤 수 있습니다.</p>}
      {state === "unsupported" && <p>이 브라우저는 알림을 지원하지 않습니다. Chrome이나 설치한 앱에서 켜 주세요.</p>}
      {state === "denied" && <p>알림이 차단되어 있습니다. 휴대폰(또는 브라우저) 설정에서 이 사이트의 알림을 허용해 주세요.</p>}
    </div>
  );
}

/** 앱 설치 안내 (안드로이드 Chrome은 버튼으로 바로 설치) */
function InstallGuide() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || !!navigator.standalone);
    const h = (e) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (installed) return <div className="push-box"><b>앱 설치</b><p>앱으로 실행 중입니다.</p></div>;
  return (
    <div className="push-box">
      <b>앱 설치</b>
      {prompt && (
        <p><button className="btn" onClick={async () => { prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>앱으로 설치</button></p>
      )}
      <p><b>갤럭시</b> Chrome 오른쪽 위 <b>⋮</b> → <b>앱 설치</b>(또는 홈 화면에 추가)</p>
      <p><b>아이폰</b> Safari 아래 <b>공유(□↑)</b> → <b>홈 화면에 추가</b></p>
      <p>설치한 앱을 열고 위의 <b>알림 받기</b>를 ON으로 켜 주세요.</p>
    </div>
  );
}

function Subscribe({ say }) {
  return (
    <details className="sub-mini">
      <summary>알림 · 앱 설치</summary>
      <DevicePush say={say} />
      <InstallGuide />
    </details>
  );
}

function extOf(name) {
  const m = String(name).match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toUpperCase() : "파일";
}

const fileLink = (f, detailUrl) =>
  `/api/file?u=${encodeURIComponent(f.url)}&n=${encodeURIComponent(f.name)}&d=${encodeURIComponent(detailUrl || "")}`;

function Files({ files, detailUrl, loading }) {
  const [busy, setBusy] = useState(false);
  if (!files.length && loading) return <div className="files"><span className="file-none">첨부파일 목록을 불러오는 중</span></div>;
  if (!files.length) {
    return (
      <div className="files">
        <a className="file-none" href={detailUrl} target="_blank" rel="noreferrer">첨부파일은 나라장터 공고에서 확인</a>
      </div>
    );
  }
  const all = async () => {
    setBusy(true);
    for (const f of files) {
      const a = document.createElement("a");
      a.href = fileLink(f, detailUrl);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 1200));
    }
    setBusy(false);
  };
  return (
    <div className="files">
      {files.map((f) => (
        <a key={f.url} className="file" href={fileLink(f, detailUrl)} download={f.name} title={`${f.name} 받기`}>
          <span className="ext">{extOf(f.name)}</span>
          <span className="fname">{f.name}</span>
        </a>
      ))}
      {files.length > 1 && (
        <button className="file-all" onClick={all} disabled={busy}>{busy ? "받는 중" : `전체 받기 (${files.length})`}</button>
      )}
    </div>
  );
}

const TONE = { good: "v-good", warn: "v-warn", bad: "v-bad" };

/** 목록에서 보이는 짧은 표시 */
function ReviewBadge({ bid: b, an }) {
  const v = b.analysis?.review?.verdict;
  if (an.working) return <div className="an-wait"><span className="dot on" aria-hidden />리스크 분석 중</div>;
  if (!v) return <div className="an-wait">검토·분석에서 분석 결과를 볼 수 있습니다</div>;
  return (
    <div className="rv-badge-row">
      <span className={`rv-badge ${TONE[v.tone]}`}>{v.level}</span>
      <span className="rv-badge-hint">검토·분석에서 확인</span>
    </div>
  );
}

/** 검토·분석 탭의 상세 분석 */
function Review({ bid: b, an }) {
  const a = b.analysis;
  if (!a || !a.review) {
    if (an.error) {
      return (
        <div className="an-wait an-err">
          분석하지 못했습니다: {an.error} <button className="mini" onClick={() => an.retry(true)}>다시 시도</button>
        </div>
      );
    }
    return (
      <div className="an-wait">
        <span className={an.working ? "dot on" : "dot"} aria-hidden />
        {an.working ? "첨부파일을 읽고 리스크를 분석하는 중입니다" : "분석 대기 중"}
      </div>
    );
  }
  // 직접생산확인은 항상 충족되므로 표시하지 않음 (예전 분석 포함)
  const noDP = (x) => !/직접\s*생산/.test(typeof x === "string" ? x : `${x.item} ${x.detail || ""}`);
  const r = { ...a.review, risks: a.review.risks.filter(noDP), checklist: (a.review.checklist || []).filter(noDP) };
  const has = (x) => (Array.isArray(x) ? x.length > 0 : !!x && x !== "문서에 없음");
  const short = (x, k) => (x.length > k ? x.slice(0, k - 1) + "…" : x);
  const key = r.risks.filter((x) => x.level !== "참고"); // 높음·주의만
  const minor = r.risks.filter((x) => x.level === "참고").map((x) => x.item);
  const what = has(a.tasks) ? a.tasks.slice(0, 3).map((x) => short(x.replace(/[.。]$/, ""), 40)).join(" · ") : "";
  const deliver = has(a.deliverables) ? a.deliverables.slice(0, 3).map((x) => short(x.replace(/[.。]$/, ""), 45)).join(" · ") : "";
  const pres = has(a.presentation) ? short(a.presentation[0], 80) : "";
  const period = has(a.period) ? a.period.replace(/^\S*기간\s*[:：]?\s*/, "") : "";

  return (
    <div className="rv-box">
      <div className={`verdict ${TONE[r.verdict.tone]}`}>
        <strong>{r.verdict.level}</strong>
        <span>{r.verdict.reason}</span>
      </div>

      <dl className="rv-core">
        <div><dt>하는 일</dt><dd>{what || "문서에서 찾지 못함"}</dd></div>
        <div><dt>납품물</dt><dd>{deliver || "문서에서 찾지 못함"}{r.unit && <em> — {r.unit.replace(/\s*\(.*\)$/, "")}</em>}</dd></div>
        {period && <div><dt>기간</dt><dd>{period}</dd></div>}
        {pres && <div><dt>발표</dt><dd>{pres}</dd></div>}
      </dl>

      {key.length > 0 && (
        <ul className="risks">
          {key.slice(0, 5).map((x, i) => (
            <li key={i}>
              <span className={`lv lv-${x.level === "높음" ? "hi" : "mid"}`}>{x.level}</span>
              <div>
                <b>{x.item}</b>
                {has(x.detail) && <p>{short(x.detail, 90)}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {minor.length > 0 && <p className="rv-minor">참고: {minor.join(" · ")}</p>}

      {r.checklist?.length > 0 && (
        <p className="rv-check"><b>입찰 전 확인</b> {r.checklist.slice(0, 3).join(" / ")}</p>
      )}

      <div className="an-foot">
        <span>{a.sources?.length ? `읽은 파일 ${a.sources.length}개` : "첨부를 읽지 못해 공고 정보로만 판단"}</span>
        <button className="mini" onClick={() => an.retry(true)} disabled={an.working}>{an.working ? "다시 분석하는 중" : "다시 분석"}</button>
      </div>
    </div>
  );
}

/** 검토·분석 / 참여: 분석 리포트 형식 */
function ReportCard({ bid: b, onUpdate, an, focused, section, say }) {
  const d = dday(b.close_at);
  const a = b.analysis;
  const r = a?.review;
  const ws = winScore(b, a);
  const noDP = (x) => !/직접\s*생산/.test(typeof x === "string" ? x : `${x.item} ${x.detail || ""}`);
  const risks = (r?.risks || []).filter(noDP);
  const checklist = (r?.checklist || []).filter(noDP);
  const has = (x) => (Array.isArray(x) ? x.length > 0 : !!x && x !== "문서에 없음");
  const staff = (a?.staff || []).filter((x) => has(x?.role)).map((x) => (has(x.detail) ? `${x.role} (${x.detail})` : x.role));
  const period = has(a?.period) ? a.period.replace(/^\S*기간\s*[:：]?\s*/, "") : "";
  const revised = String(b.bid_ord || "").replace(/0/g, "") !== "";
  const lvClass = (lv) => (lv === "높음" ? "hi" : lv === "주의" ? "mid" : "lo");
  const no = { n: 0 };
  const H = ({ children }) => <h3 className="rp-h"><span>{String(++no.n).padStart(2, "0")}</span>{children}</h3>;

  return (
    <article id={`bid-${b.key}`} className={`report ${focused ? "focused" : ""}`}>
      <header className="rp-head">
        <div className="rp-kicker">
          <span>{section === "join" ? "참여 결정 공고" : "입찰 검토 리포트"}</span>
          <span className={`rp-dday ${d.tone}`}>{d.big}{d.big !== "마감" ? "" : ""}</span>
        </div>
        <a className="rp-title" href={b.url} target="_blank" rel="noreferrer">
          {(a?.video?.only ?? titleVideoOnly(b.title)) ? <span className="prio only">영상 제작</span>
            : a?.video?.priority && <span className="prio">교수설계+영상</span>}
          {revised && <span className="revised">정정</span>}
          {b.title}
        </a>
        {ws && (
          <div className={`rp-stamp g-${ws.grade}`}>
            <b>{ws.score}</b><small>점</small>
            <span>{ws.grade} · {ws.label}</span>
          </div>
        )}
      </header>

      <dl className="rp-info">
        <div><dt>공고기관</dt><dd>{b.org || "-"}{b.demand_org && b.demand_org !== b.org ? ` / 수요 ${b.demand_org}` : ""}</dd></div>
        <div><dt>추정가격</dt><dd>{b.price ? `${b.price.toLocaleString("ko-KR")}원` : "미공개"}</dd></div>
        <div><dt>입찰마감</dt><dd>{when(b.close_at)}</dd></div>
        <div><dt>참가지역</dt><dd>{b.region || "확인 중"}</dd></div>
        <div><dt>공고번호</dt><dd>{b.bid_no}-{b.bid_ord}</dd></div>
        <div><dt>게시일</dt><dd>{at(b.posted_at)}</dd></div>
      </dl>

      {!r ? (
        <div className="rp-body">
          {an.error ? (
            <div className="an-wait an-err">분석하지 못했습니다: {an.error} <button className="mini" onClick={() => an.retry(true)}>다시 시도</button></div>
          ) : (
            <div className="an-wait"><span className={an.working ? "dot on" : "dot"} aria-hidden />{an.working ? "첨부 문서를 읽고 리포트를 작성하는 중입니다" : "분석 대기 중"}</div>
          )}
        </div>
      ) : (
        <div className="rp-body">
          <section>
            <H>종합 판단</H>
            <div className={`rp-verdict ${TONE[r.verdict.tone]}`}>
              <strong>수주 가능성 {ws.score}점 · {ws.label}</strong>
              <p>{r.verdict.level}: {r.verdict.reason}</p>
            </div>
            <ul className="rp-score">{ws.reasons.map((x, i) => <li key={i} className={x.startsWith("+") ? "plus" : "minus"}>{x}</li>)}</ul>
          </section>

          <section>
            <H>사업 개요</H>
            {has(a.summary) && !/AI 요약 아님|찾지 못했습니다/.test(a.summary) && <p className="rp-lead">{a.summary}</p>}
            <div className="rp-two">
              <div>
                <h4>수행 업무</h4>
                {has(a.tasks) ? <ol>{a.tasks.slice(0, 6).map((x, i) => <li key={i}>{x}</li>)}</ol> : <p className="na">문서에서 찾지 못함</p>}
              </div>
              <div>
                <h4>최종 납품물</h4>
                {has(a.deliverables) ? <ul>{a.deliverables.slice(0, 6).map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="na">문서에서 찾지 못함</p>}
                {r.unit && <p className="rp-unit">{r.unit}</p>}
              </div>
            </div>
          </section>

          {risks.length > 0 && (
            <section>
              <H>리스크 평가</H>
              <table className="rp-risk">
                <thead><tr><th>수준</th><th>항목</th><th>근거</th></tr></thead>
                <tbody>
                  {risks.map((x, i) => (
                    <tr key={i}>
                      <td><span className={`lv lv-${lvClass(x.level)}`}>{x.level}</span></td>
                      <td><b>{x.item}</b></td>
                      <td>{x.detail || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {checklist.length > 0 && (
            <section>
              <H>입찰 전 확인 사항</H>
              <ul className="chk">{checklist.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </section>
          )}

          <section>
            <H>조건 · 일정</H>
            <dl className="rp-info rp-cond">
              {period && <div><dt>수행기간</dt><dd>{period}</dd></div>}
              {staff.length > 0 && <div><dt>투입인력</dt><dd>{staff.join(", ")}</dd></div>}
              {has(a.eligibility) && <div><dt>참가자격</dt><dd>{a.eligibility.join(" / ")}</dd></div>}
              {has(a.evaluation) && <div><dt>평가방식</dt><dd>{a.evaluation}</dd></div>}
              {has(a.presentation) && <div><dt>제안발표</dt><dd>{a.presentation.join(" / ")}</dd></div>}
              {has(a.schedule) && <div><dt>주요일정</dt><dd>{a.schedule.join(" / ")}</dd></div>}
            </dl>
          </section>
        </div>
      )}

      <section className="rp-files">
        <H>첨부 문서</H>
        <Files files={b.files || []} detailUrl={b.url} loading={an.working} />
      </section>

      <footer className="rp-foot">
        <span className="rp-src">
          {a?.sources?.length ? `분석 근거: ${a.sources.join(", ")}` : r ? "첨부를 읽지 못해 공고 정보로만 판단" : ""}
          {r && <button className="mini" onClick={() => an.retry(true)} disabled={an.working}>{an.working ? "다시 분석하는 중" : "다시 분석"}</button>}
        </span>
        <Stamps bid={b} onUpdate={onUpdate} an={an} say={say} section={section} />
      </footer>
    </article>
  );
}

function Stamps({ bid: b, onUpdate, an, say, section }) {
  return (
    <div className="stamps" aria-label="검토 상태">
      {STAMPS.filter(([id]) =>
        section === "review" ? true : section === "join" ? id !== "review" : id !== "join"
      ).map(([id, label]) => {
        const on = b.status === id;
        return (
          <button
            key={id} className={`stamp ${id} ${on ? "on" : ""}`} aria-pressed={on}
            title={on ? `${label} 해제` : `${label}(으)로 표시`}
            onClick={() => {
              if (id === "pass") {
                const prev = b.status;
                onUpdate(b.key, { status: "pass" });
                say("불참으로 삭제했습니다.", false, () => onUpdate(b.key, { status: prev }));
                return;
              }
              // 참여 해제는 검토·분석으로 되돌림
              onUpdate(b.key, { status: on ? (id === "join" ? "review" : "new") : id });
              if (!on && id === "join") say("참여로 옮겼습니다.");
              if (!on && id === "review") {
                say("검토·분석에 추가하고 리스크 분석을 시작합니다.");
                an.retry(false);
              }
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function BidRow({ bid: b, onUpdate, an, focused, detail, say, section }) {
  const d = dday(b.close_at);
  const revised = String(b.bid_ord || "").replace(/0/g, "") !== "";

  return (
    <article id={`bid-${b.key}`} className={`bid st-${b.status} ${focused ? "focused" : ""}`}>
      <div className={`dday ${d.tone}`} title={`입찰마감 ${when(b.close_at)}`}>
        <b>{d.big}</b>
        <small>{d.small || when(b.close_at).replace(/\s\d{2}:\d{2}$/, "")}</small>
      </div>

      <div className="body">
        <a className="title" href={b.url} target="_blank" rel="noreferrer">
          {(b.analysis?.video?.only ?? titleVideoOnly(b.title)) ? <span className="prio only">영상 제작</span>
            : b.analysis?.video?.priority && <span className="prio">교수설계+영상</span>}
          {revised && <span className="revised">정정</span>}
          {b.title}
        </a>
        <div className="meta">
          <span>{b.org || "-"}{b.demand_org && b.demand_org !== b.org ? ` (수요 ${b.demand_org})` : ""}</span>
          <span className="price" title={b.price ? `${b.price.toLocaleString("ko-KR")}원` : ""}>{money(b.price)}</span>
          <span>마감 {when(b.close_at)}</span>
          {b.region && b.region !== "전국" && <span className="region">참가지역 {b.region}</span>}
          <span>게시 {at(b.posted_at)}</span>
        </div>
        <div className="chips">
          {b.keywords.map((k) => <span key={k} className="chip by-rule">{k}</span>)}
        </div>

        <Files files={b.files || []} detailUrl={b.url} loading={an.working} />
        {detail && <Review bid={b} an={an} />}
      </div>

      <Stamps bid={b} onUpdate={onUpdate} an={an} say={say} section={section} />
    </article>
  );
}
