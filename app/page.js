"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { at, dday, money, when } from "@/components/format";
import { winScore, reviewRisks, BOILERPLATE } from "@/lib/score";
import { cashNeed } from "@/lib/payment";
import { estimateCost, COST, LABOR, UNIT, costModel } from "@/lib/cost";
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

/** 실제로 일을 주는 곳: 조달청이 대행한 공고는 수요기관을 씀 */
const clientOf = (b) => {
  const org = String(b.org || "").trim(), dem = String(b.demand_org || "").trim();
  if (dem && (/조달청/.test(org) || !org)) return dem;
  return org || dem || "기관 미상";
};

export default function Home() {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [tab, setTab] = useState("new"); // "new" 또는 맨 아래 링크로 여는 "pass"
  const [section, setSection] = useState("bids"); // bids: 입찰 공고, review: 검토·분석
  const [orgPick, setOrgPick] = useState(""); // 검토·분석 하위 분류: 공고기관
  const [rule, setRule] = useState("");
  const [q, setQ] = useState("");
  const [showLow, setShowLow] = useState(false); // 영상 비중 낮은 공고 보기
  const [focus, setFocus] = useState(null);
  const [started, setStarted] = useState({}); // 분석 시작 시각
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("bid")) setFocus(sp.get("bid"));
    if (sp.get("report")) setFocus(sp.get("report")); // 예전 '리포트 크게 보기' 주소도 목록 화면에서 열기
  }, []);
  // 리포트 보기: 카테고리(검토·분석/참여)가 있는 화면에서 그 리포트로 이동
  const openReport = (key) => {
    const b = data?.bids?.find((x) => x.key === key);
    if (!b) return;
    setOrgPick("");
    setSection(b.status === "join" ? "join" : b.status === "review" ? "review" : "bids");
    setFocus(key);
    setTimeout(() => document.getElementById(`bid-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  };
  const [collecting, setCollecting] = useState(false);
  const [toast, setToast] = useState(null);

  const say = (text, bad, undo, action) => {
    setToast({ text, bad, undo, action });
    clearTimeout(say.t);
    say.t = setTimeout(() => setToast(null), undo || action ? 8000 : 3500);
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
    setStarted((t) => ({ ...t, [key]: Date.now() }));
    setTried((t) => ({ ...t, [key]: true }));
    setFailed((f) => { const n = { ...f }; delete n[key]; return n; });
    try {
      const t0 = Date.now();
      const a = await api("/api/analyze", { method: "POST", body: JSON.stringify({ key, force }) });
      setAnalysis(key, a);
      if (Date.now() - t0 > 15000) analyze.done?.(key); // 오래 걸린 분석은 끝났다고 알림
    } catch (e) {
      // 한 번 실패하면 잠시 뒤 자동으로 다시 시도
      if (!analyze.retried) analyze.retried = new Set();
      if (!analyze.retried.has(key)) {
        analyze.retried.add(key);
        setTried((t) => { const n = { ...t }; delete n[key]; return n; });
        await new Promise((r) => setTimeout(r, 4000));
      } else {
        setFailed((f) => ({ ...f, [key]: e.message }));
      }
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
      (!b.analysis || !b.analysis.review || (b.analysis.ver || 0) < 8 || !(b.files || []).length);
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
    setTimeout(() => document.getElementById(`bid-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
  }, [focus, data?.bids?.length]);

  const update = async (key, patch, localOnly = false) => {
    setData((d) => ({ ...d, bids: d.bids.map((b) => (b.key === key ? { ...b, ...patch } : b)) }));
    if (localOnly) return; // 이미 서버에 저장된 값을 화면에만 반영
    try {
      await api(`/api/bids/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (e) {
      say(`저장하지 못했습니다: ${e.message}`, true);
      load();
    }
  };

  analyze.done = (key) => say("분석이 끝났습니다.", false, null, { label: "리포트 보기", fn: () => openReport(key) });

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
    .map((b) => [b, winScore(b, b.analysis, data?.costModel)?.score ?? -1])
    .sort((x, y) => y[1] - x[1])
    .map((x) => x[0]);
  const joinList = base.filter((b) => b.status === "join");
  // 공고기관 이름 정리: "OO대학교 산학협력단" → "OO대학교" 처럼 큰 단위로 묶음
  const orgName = (b) => clientOf(b).replace(/\s*(산학협력단|산학협력단장|본부|사업단|센터)$/, "").trim();
  const orgs = [...reviewList.reduce((m, b) => m.set(orgName(b), (m.get(orgName(b)) || 0) + 1), new Map())].sort((x, y) => y[1] - x[1]);
  const shown =
    section === "review" ? reviewList.filter((b) => !orgPick || orgName(b) === orgPick) :
    section === "join" ? joinList :
    bidsOnly.filter((b) => b.status === "new");
  const run = data?.lastRun;

  const anOf = (b) => ({ working: working === b.key, error: failed[b.key], started: started[b.key], retry: (force) => analyze(b.key, force) });
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



      {section === "review" && orgs.length > 1 && (
        <div className="org-tabs" role="tablist" aria-label="공고기관별">
          <button className={!orgPick ? "on" : ""} onClick={() => setOrgPick("")}>전체 <span>{reviewList.length}</span></button>
          {orgs.map(([o, n]) => (
            <button key={o} className={orgPick === o ? "on" : ""} onClick={() => setOrgPick(o)}>{o} <span>{n}</span></button>
          ))}
        </div>
      )}

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
            model={data?.costModel} onModel={(m) => setData((d) => ({ ...d, costModel: m }))}
            onLocal={(key, patch) => setData((d) => ({ ...d, bids: d.bids.map((x) => (x.key === key ? { ...x, ...patch } : x)) }))}
            an={anOf(b)} /> : <BidRow key={b.key} bid={b} onUpdate={update} focused={focus === b.key} detail={false} section={section} say={say}
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
          {toast.action && <button className="toast-undo" onClick={() => { toast.action.fn(); setToast(null); }}>{toast.action.label}</button>}
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
        <a key={f.url} className={`file ${f.rfp ? "rfp-file" : ""}`} href={fileLink(f, detailUrl)} download={f.name} title={`${f.name} 받기`}>
          {f.rfp && <span className="rfp-tag">{f.doc || "제안요청서"}</span>}
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

/** 분석 진행 안내: 단계와 경과 시간 */
function AnalyzeProgress({ started }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.round((now - (started || now)) / 1000));
  const steps = ["첨부 목록·제안요청서 확인", "제안요청서·과업지시서 내려받기", "문서 전체 읽기 (표·요구사항 포함)", "분량·인력·비용 항목 추출", "원가·마진·리스크 산정"];
  const at = sec < 4 ? 0 : sec < 15 ? 1 : sec < 60 ? 2 : sec < 100 ? 3 : 4;
  return (
    <div className="an-progress">
      <div className="ap-head"><span className="dot on" aria-hidden /> 제안요청서를 꼼꼼히 분석하는 중 · {Math.floor(sec / 60) ? `${Math.floor(sec / 60)}분 ` : ""}{sec % 60}초</div>
      <ol>{steps.map((x, i) => <li key={i} className={i < at ? "done" : i === at ? "now" : ""}>{x}</li>)}</ol>
      <p>문서가 길면 1~4분 걸립니다. 다른 공고를 보셔도 되고, 끝나면 "리포트 보기" 알림이 뜹니다.</p>
    </div>
  );
}

/** 회사 원가 기준 (모든 리포트에 공통 적용) */
function CostEditor({ model, onSaved, say }) {
  const M = costModel(model);
  const pc = (x) => Math.round(x * 100);
  const init = {
    internalPeople: M.internalPeople, internalMonthly: M.internalMonthly, ownFacility: M.ownFacility ? 1 : 0,
    rateHigh: M.rate.고급, rateMid: M.rate.중급, rateLow: M.rate.초급, days: M.days, teamMax: M.teamMax,
    ownerGA: pc(M.ownerGA), ownerProfit: pc(M.ownerProfit), laborShare: pc(M.laborShare), burden: pc(M.burden), overhead: pc(M.overhead), rework: pc(M.rework), contingency: pc(M.contingency),
    fixedMonthly: Math.round(M.fixedMonthly / 10000), pmPerMonth: M.pmPerMonth, proposalMM: M.proposalMM,
  };
  for (const k of Object.keys(UNIT)) { init[`mm_${k}`] = M.units[k].mm; init[`direct_${k}`] = Math.round(M.units[k].direct / 10000); }
  const [f, setF] = useState(init);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = {
      ...f, ownerGA: Number(f.ownerGA) / 100, ownerProfit: Number(f.ownerProfit) / 100, laborShare: Number(f.laborShare) / 100, burden: Number(f.burden) / 100, overhead: Number(f.overhead) / 100, rework: Number(f.rework) / 100,
      contingency: Number(f.contingency) / 100, fixedMonthly: Number(f.fixedMonthly) * 10000,
    };
    for (const k of Object.keys(UNIT)) body[`direct_${k}`] = Number(f[`direct_${k}`]) * 10000;
    try { onSaved(await api("/api/cost-model", { method: "PUT", body: JSON.stringify(body) })); }
    catch (e) { say(e.message, true); }
  };
  // 입력 중 포커스가 풀리지 않도록 컴포넌트가 아닌 함수로 그림
  const F = (k, label, unit) => (
    <label key={k}><span>{label}</span><input className="field" inputMode="decimal" value={f[k]} onChange={set(k)} /><em>{unit}</em></label>
  );
  return (
    <div className="cost-edit">
      <p>발주처 예산 = 순원가(노무비 + 경비) × (1 + 일반관리비) × (1 + 이윤)로 역산하고, 그 노무비만큼 인력을 배치합니다. 산출내역서가 있으면 그 금액을 그대로 씁니다. 고치면 모든 공고에 바로 다시 계산됩니다.</p>
      <div className="ce-grid">
        {F("rateHigh", "고급 1일 노임 (PM·교수설계)", "원")}
        {F("rateMid", "중급 1일 노임 (촬영·편집·디자인)", "원")}
        {F("rateLow", "초급 1일 노임 (자막·검수)", "원")}
        {F("ownFacility", "자체 스튜디오·장비 (1=보유)", "")}
        {F("internalPeople", "내부 제작 인력", "명")}
        {F("internalMonthly", "내부 제작 인력 월 인건비 (0=노임단가)", "원")}
        {F("days", "월 근무일수", "일")}
        {F("teamMax", "동시 가용 인력", "명")}
        {F("ownerGA", "발주처 일반관리비율", "%")}
        {F("ownerProfit", "발주처 이윤율", "%")}
        {F("laborShare", "발주처 순원가 중 노무비 비중", "%")}
        {F("burden", "법정부담금", "%")}
        {F("overhead", "제경비", "%")}
        {F("rework", "수정·검수 대응", "%")}
        {F("contingency", "예비비", "%")}
        {F("fixedMonthly", "월 고정경비", "만원")}
        {F("pmPerMonth", "PM 최소 투입", "M/M/월")}
        {F("proposalMM", "제안·계약 대응", "M/M")}
      </div>
      <div className="ce-grid">
        {Object.entries(UNIT).flatMap(([k, u]) => [F(`mm_${k}`, `${u.label} 1개`, "M/M"), F(`direct_${k}`, `${k} 1개 경비`, "만원")])}
      </div>
      <button className="btn primary" onClick={save}>저장</button>
    </div>
  );
}

/** 검토·분석 / 참여: 분석 리포트 형식 */
function ReportCard({ bid: b, onUpdate, an, focused, section, say, model, onModel, onLocal }) {
  const d = dday(b.close_at);
  const a = b.analysis;
  const r = a?.review;
  const ws = winScore(b, a, model);
  const risks = r ? reviewRisks(b, a, model) : [];
  const checklist = (r?.checklist || []).filter((x) => !BOILERPLATE.test(x));
  const est = r ? estimateCost(b, a, model) : null;
  const [editCost, setEditCost] = useState(false);
  const keyRisks = risks.filter((x) => x.level !== "참고").slice(0, 3).map((x) => x.item);
  const inf = new Set(a?.inferred || []);
  const short = (x, k) => (String(x).length > k ? String(x).slice(0, k - 1) + "…" : String(x));
  const Est = ({ k }) => (inf.has(k) ? <em className="est">추정</em> : null);
  const fs = a?.fileStatus || [];
  const readOk = fs.filter((x) => /읽음/.test(x.status)).length;
  const why = !(b.files || []).length ? "첨부파일이 없는 공고"
    : !fs.length ? "문서에서 찾지 못함"
    : readOk === 0 && fs.every((x) => /받기 실패/.test(x.status)) ? "첨부를 내려받지 못함"
    : readOk === 0 && fs.some((x) => /스캔/.test(x.status)) ? "스캔 이미지 문서라 글자를 읽지 못함"
    : readOk === 0 ? "읽을 수 있는 문서 형식이 아님"
    : "문서에 해당 내용이 없거나 양식이 달라 찾지 못함";
  const has = (x) => (Array.isArray(x) ? x.length > 0 : !!x && x !== "문서에 없음");
  const staff = (a?.staff || []).filter((x) => has(x?.role)).map((x) => (has(x.detail) ? `${x.role} (${x.detail})` : x.role));
  const period = has(a?.period) ? a.period.replace(/^\S*기간\s*[:：]?\s*/, "") : "";
  const revised = String(b.bid_ord || "").replace(/0/g, "") !== "";
  const lvClass = (lv) => (lv === "높음" ? "hi" : lv === "주의" ? "mid" : "lo");
  const no = { n: 0 };
  const H = ({ children }) => <h3 className="rp-h"><span>{String(++no.n).padStart(2, "0")}</span>{children}</h3>;

  return (
    <article id={`bid-${b.key}`} data-key={b.key} className={`report ${focused ? "focused" : ""}`}>
      <header className="rp-head">
        <div className="rp-kicker">
          <span>{section === "join" ? "참여 결정 공고" : "입찰 검토 리포트"}</span>
          <span className={`rp-dday ${d.tone}`}>{d.big}</span>
          {(() => {
            const rfp = (a?.fileStatus || []).find((x) => /제안\s*요청/.test(x.name));
            const hasRfp = (b.files || []).some((x) => /제안\s*요청/.test(x.name));
            if (rfp && /읽음/.test(rfp.status)) return <span className="rfp ok">제안요청서 분석 완료</span>;
            if (rfp) return <span className="rfp ng">제안요청서 {rfp.status}</span>;
            if (hasRfp) return <span className="rfp ng">제안요청서 미분석</span>;
            return a ? <span className="rfp ng">제안요청서 없음</span> : null;
          })()}
        </div>
        {r && !an.working && (
          <button className="mini rp-open" onClick={() => {
            const el = document.getElementById(`bid-${b.key}`);
            document.body.dataset.print = "1";
            if (el) el.dataset.printMe = "1";
            const done = () => { delete document.body.dataset.print; if (el) delete el.dataset.printMe; window.removeEventListener("afterprint", done); };
            window.addEventListener("afterprint", done);
            window.print();
          }}>인쇄 · PDF</button>
        )}
        <a className="rp-title" href={b.url} target="_blank" rel="noreferrer">
          {(a?.video?.only ?? titleVideoOnly(b.title)) ? <span className="prio only">영상 제작</span>
            : a?.video?.priority && <span className="prio">교수설계+영상</span>}
          {revised && <span className="revised">정정</span>}
          {b.title}
        </a>
        {ws && !an.working && (
          <div className={`rp-stamp g-${ws.grade}`}>
            <b>{ws.score}</b><small>점</small>
            <span>{ws.grade} · {ws.label}</span>
          </div>
        )}
      </header>

      {r && !an.working && <dl className="rp-info">
        <div><dt>발주기관</dt><dd>{clientOf(b)}{/조달청/.test(b.org || "") && b.demand_org ? <small className="via"> (조달청 대행)</small> : b.demand_org && b.demand_org !== b.org ? <small className="via"> · 수요 {b.demand_org}</small> : null}</dd></div>
        <div><dt>추정가격</dt><dd>{b.price ? `${b.price.toLocaleString("ko-KR")}원` : "미공개"}</dd></div>
        <div><dt>입찰마감</dt><dd>{when(b.close_at)}</dd></div>
        <div><dt>참가지역</dt><dd>{b.region || "확인 중"}</dd></div>
        <div><dt>공고번호</dt><dd>{b.bid_no}-{b.bid_ord}</dd></div>
        <div><dt>게시일</dt><dd>{at(b.posted_at)}</dd></div>
        {a?.presenter && <div className="rp-presenter"><dt>제안발표</dt><dd><b>{a.presenter}</b> <Est k="presenter" /></dd></div>}
      </dl>}

      {(!r || an.working) ? (
        <div className="rp-body">
          {an.error ? (
            <div className="an-wait an-err">분석하지 못했습니다: {an.error} <button className="mini" onClick={() => an.retry(true)}>다시 시도</button></div>
          ) : (
            an.working ? <AnalyzeProgress started={an.started} /> : <div className="an-wait"><span className="dot" aria-hidden />분석 대기 중</div>
          )}
        </div>
      ) : (
        <div className="rp-body">
          <section>
            <H>종합 판단</H>
            <div className={`rp-verdict ${ws.grade === "A" ? "v-good" : ws.grade === "B" ? "v-warn" : "v-bad"}`}>
              <strong>수주 가능성 {ws.score}점 · {ws.label}</strong>
              <p>{keyRisks.length ? `핵심 리스크: ${keyRisks.join(", ")}` : "큰 위험 요소가 보이지 않습니다."}</p>
            </div>
            <ul className="rp-score">{ws.reasons.map((x, i) => <li key={i} className={x.startsWith("+") ? "plus" : "minus"}>{x}</li>)}</ul>
          </section>

          {est && (
            <section>
              <H>발주처 원가 구조 · 수행 계획</H>
              {est.confidence === "낮음" && (
                <p className="rp-warn">분량을 문서에서 확인하지 못해 가정으로 계산했습니다. 마진·점수가 실제와 크게 다를 수 있으니 제안요청서의 분량(강좌·주차·차시·편수)을 확인하세요.</p>
              )}
              {est.owner && (
                <>
                  <p className="rp-plan-note">발주처가 이미 계산해 둔 예산을 풀어서, <b>그 노무비만큼 인력을 배치</b>하는 것을 기준으로 봅니다. ({est.owner.source})</p>
                  <table className="rp-mm rp-owner">
                    <thead><tr><th>발주처 원가</th><th>내용</th><th>금액</th></tr></thead>
                    <tbody>
                      <tr><td>노무비</td><td>발주처 기준 투입 약 <b>{Math.round(est.owner.mm * 10) / 10}M/M</b> = {est.heads}명 × 평균 {Math.round(est.avgRatePlan * 100)}% × {est.months}개월</td><td>{est.won(est.owner.L0)}</td></tr>
                      <tr><td>경비</td><td>장비·출연·외주·4대보험 등</td><td>{est.won(est.owner.E0)}</td></tr>
                      <tr><td>{est.owner.gaLabel}</td><td></td><td>{est.won(est.owner.G0)}</td></tr>
                      <tr><td>{est.owner.pLabel}</td><td></td><td>{est.won(est.owner.P0)}</td></tr>
                      <tr className="sum"><td>추정가격</td><td>부가세 제외</td><td>{est.fmt.supply}</td></tr>
                    </tbody>
                  </table>
                </>
              )}
              <div className="rp-kpis">
                <div><span>투입 인력 (발주처 산정)</span><b>{est.heads}명</b><small>평균 투입률 {Math.round(est.avgRatePlan * 100)}% × {est.months}개월</small></div>
                <div className={est.intensity === null ? "" : est.intensity <= 1.3 ? "good" : "warn"}>
                  <span>회사 기준 필요량</span><b>{est.intensity === null ? "-" : `${Math.round(est.intensity * 100)}%`}</b>
                  <small>{est.intensity === null ? "가격 미공개" : `발주처 산정 대비 (필요 투입률 ${Math.round(est.avgRateNeed * 100)}%)`}</small>
                </div>
                <div><span>우리 수행 원가</span><b>{est.fmt.total}</b><small>인건비 {est.fmt.labor} · 경비 {est.fmt.direct}</small></div>
                <div className={est.margin === null ? "" : est.margin < 0 ? "bad" : est.margin < 0.1 ? "warn" : "good"}><span>예상 마진</span><b>{est.margin === null ? "-" : `${Math.round(est.margin * 100)}%`}</b>
                  <small>{est.margin === null ? "가격 미공개" : `순이익 ${Math.round((est.net / est.supply) * 100)}%`}</small></div>
              </div>
              <table className="rp-mm">
                <thead><tr><th>역할 (수행 계획)</th><th>등급</th><th>인원</th><th>투입률</th><th>회사 기준</th><th>인건비</th></tr></thead>
                <tbody>
                  {est.table.map((x, i) => <tr key={i}><td>{x.role}</td><td>{x.grade}</td><td>{x.heads}명</td><td>{Math.round(x.rate * 100)}%</td><td className={x.needRate > x.rate * 1.25 ? "neg" : ""}>{Math.round(x.needRate * 100)}%</td><td>{est.won(x.cost)}</td></tr>)}
                  {est.inMM > 0 && <tr className="sub"><td>└ 내부 제작 인력</td><td>회사 설정 인건비</td><td></td><td></td><td>{est.inMM}</td><td>{est.won(est.inLabor)}</td></tr>}
                  {est.inMM > 0 && <tr className="sub"><td>└ 그 외</td><td>노임단가</td><td></td><td></td><td>{est.exMM}</td><td>{est.won(est.exLabor)}</td></tr>}
                  <tr className="sum"><td>① 직접인건비</td><td></td><td>{est.heads}명</td><td>평균 {Math.round(est.avgRatePlan * 100)}%</td><td>평균 {Math.round(est.avgRateNeed * 100)}%</td><td>{est.fmt.labor}</td></tr>
                  <tr><td>② 법정부담금</td><td colSpan={4}>4대보험 사업주분 등, ①의 {Math.round(est.model.burden * 100)}%</td><td>{est.fmt.burden}</td></tr>
                  <tr><td>③ 직접경비</td><td colSpan={4}>{est.model.ownFacility ? "자체 스튜디오·장비 사용(제외), 출연·외주·소모품" : "장비·스튜디오·출연·외주"} + 월 고정경비 {Math.round(est.model.fixedMonthly / 10000)}만원 × {est.months}개월</td><td>{est.fmt.direct}</td></tr>
                  <tr className="sum"><td>직접원가 (①+②+③)</td><td colSpan={4}></td><td>{est.fmt.total}</td></tr>
                  {est.supply && <>
                    <tr><td>추정가격</td><td colSpan={4}>부가세 제외</td><td>{est.fmt.supply}</td></tr>
                    <tr className="sum"><td>마진</td><td colSpan={4}>추정가격 − 직접원가 ({Math.round(est.margin * 100)}%) = 발주처 일반관리비·이윤 + 경비 절감분</td><td className={est.margin < 0 ? "neg" : ""}>{est.fmt.margin}</td></tr>
                    <tr className="sub"><td>└ 제경비 몫</td><td colSpan={4}>직접인건비의 {Math.round(est.model.overhead * 100)}%</td><td>{est.fmt.overhead}</td></tr>
                    <tr className="sub"><td>└ 예비비 몫</td><td colSpan={4}>직접원가의 {Math.round(est.model.contingency * 100)}%</td><td>{est.fmt.contingency}</td></tr>
                    <tr className="sub"><td>└ 순이익</td><td colSpan={4}>{Math.round((est.net / est.supply) * 100)}%</td><td className={est.net < 0 ? "neg" : ""}>{est.fmt.net}</td></tr>
                  </>}
                </tbody>
              </table>
              {est.items?.length > 0 && (
                <div className="rp-items">
                  <h4>제안요청서에서 찾은 비용 항목 <small>체크를 끄면 원가에서 뺍니다</small></h4>
                  <table className="rp-mm">
                    <thead><tr><th></th><th>항목</th><th>근거 (제안요청서)</th><th>반영</th></tr></thead>
                    <tbody>
                      {est.items.map((x) => (
                        <tr key={x.key} className={x.off ? "off" : ""}>
                          <td><input type="checkbox" checked={!x.off} disabled={x.auto} onChange={async (e) => {
                            const offNow = new Set(a.costOff || []);
                            e.target.checked ? offNow.delete(x.key) : offNow.add(x.key);
                            try {
                              const res = await api(`/api/bids/${encodeURIComponent(b.key)}`, { method: "PATCH", body: JSON.stringify({ costOff: [...offNow] }) });
                              onLocal(b.key, { analysis: res.analysis });
                            } catch (err) { say(err.message, true); }
                          }} /></td>
                          <td><b>{x.label}</b><br /><small>{x.type === "expense" ? "외부 지출" : "추가 작업"} · {x.how}</small></td>
                          <td className="ev">{x.evidence}</td>
                          <td>{x.type === "expense" ? (x.amount ? est.won(x.amount) : "-") : (x.mm ? `+${x.mm}M/M` : "-")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="rp-period">
                수행기간 <b>{est.months}개월</b>
                {est.start && est.monthsSource === "문서" && est.endText
                  ? ` (계약 예정 ${new Date(est.start).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" })} ~ ${est.endText}, 시작일 = ${est.startBasis})`
                  : ` (${est.monthsSource})`} ·{" "}
                <button className="mini" onClick={async () => {
                  const v = window.prompt("실제 수행기간(개월)을 입력하세요", String(est.months));
                  if (v === null) return;
                  try {
                    const res = await api(`/api/bids/${encodeURIComponent(b.key)}`, { method: "PATCH", body: JSON.stringify({ periodMonths: Number(v) }) });
                    onLocal(b.key, { analysis: res.analysis });
                    say(`수행기간을 ${v}개월로 바꿨습니다.`);
                  } catch (e) { say(e.message, true); }
                }}>기간 수정</button>
              </p>
              <p className={`rp-conf c-${est.confidence}`}>추정 신뢰도 <b>{est.confidence}</b> — {est.basis}</p>
              {est.notes.map((x, i) => <p key={i} className="rp-note">{x}</p>)}
              <p className="rp-assume">
                인건비는 적정 최대치: PM·교수설계 고급 {est.model.rate.고급.toLocaleString("ko-KR")}원, 촬영·편집·디자인 중급 {est.model.rate.중급.toLocaleString("ko-KR")}원, 자막·검수 초급 {est.model.rate.초급.toLocaleString("ko-KR")}원/일 × {est.model.days}일
                {est.model.custom ? " (회사 설정)" : ` (${LABOR.source})`}, 가용 인력 {est.model.teamMax}명.
                {" "}<button className="mini" onClick={() => setEditCost(!editCost)}>{editCost ? "닫기" : "원가 기준 수정"}</button>
              </p>
              {editCost && <CostEditor model={model} onSaved={(m) => { onModel(m); setEditCost(false); say("원가 기준을 저장했습니다. 모든 리포트에 바로 적용됩니다."); }} say={say} />}
            </section>
          )}

          {est && (() => {
            const p = a.payment || {};
            const cash = cashNeed(p, est);
            const Row = ({ k, v, ev }) => <tr><td>{k}</td><td>{v}{ev && <><br /><small className="ev">“{ev}”</small></>}</td></tr>;
            return (
              <section>
                <H>운영 이슈 · 대금 지급</H>
                <table className="rp-mm rp-pay">
                  <tbody>
                    <Row k="지급 방식" v={<b>{p.method || "문서에 지급 조건 없음 → 완료 후 일괄 지급(후불)으로 가정"}</b>} />
                    <Row k="선금" v={p.advance ? (p.advance.has ? `있음${p.advance.pct ? ` (계약금액의 ${p.advance.pct}% 이내)` : ""}` : "지급 안 함") : "언급 없음 — 계약 시 선금 청구 가능 여부 확인"} ev={p.advance?.text} />
                    <Row k="기성(중간 지급)" v={p.progress ? "있음" : "언급 없음"} ev={p.progress?.text} />
                    <Row k="잔금 지급 시기" v={p.final ? (p.final.days ? `검수 후 ${p.final.days}일 이내` : "완료·검수 후") : "언급 없음 (검수 후 약 14일로 가정)"} ev={p.final?.text} />
                    {p.contractBond && <Row k="계약보증금" v={`${p.contractBond.pct ?? "-"}%`} ev={p.contractBond.text} />}
                    {p.warrantyBond && <Row k="하자보수보증금" v={`${p.warrantyBond.pct ?? "-"}%`} ev={p.warrantyBond.text} />}
                    {p.warrantyPeriod && <Row k="하자담보 기간" v={`${p.warrantyPeriod.months}개월`} ev={p.warrantyPeriod.text} />}
                    {p.lateFee && <Row k="지체상금" v={p.lateFee.rate ? `1일 ${p.lateFee.rate}` : "있음"} ev={p.lateFee.text} />}
                    {cash && <tr className="sum"><td>자금 선투입</td><td>대금 받기 전 회사가 먼저 쓰는 돈 약 <b>{est.won(cash.peak)}</b> (월 약 {est.won(cash.monthly)} × {est.months}개월{cash.adv > 0 ? `, 선금 ${est.won(cash.adv)} 반영` : ""}) · 수령까지 약 {Math.round(cash.waitMonths * 10) / 10}개월</td></tr>}
                  </tbody>
                </table>
              </section>
            );
          })()}

          <section>
            <H>사업 개요</H>
            {has(a.summary) && !/AI 요약 아님|찾지 못했습니다/.test(a.summary) && <p className="rp-lead">{a.summary}</p>}
            <div className="rp-two">
              <div>
                <h4>수행 업무 <Est k="tasks" /></h4>
                {has(a.tasks) ? <ol>{a.tasks.slice(0, 6).map((x, i) => <li key={i}>{x}</li>)}</ol> : <p className="na">{why}</p>}
              </div>
              <div>
                <h4>최종 납품물 <Est k="deliverables" /></h4>
                {has(a.deliverables) ? <ul>{a.deliverables.slice(0, 6).map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="na">{why}</p>}
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
                    <tr key={i} className={x.core ? "core" : ""}>
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
            <ul className="rp-brief">
              {period && <li><b>기간</b>{short(period, 50)} <Est k="period" /></li>}
              {a.presenter && <li><b>발표</b>{a.presenter}</li>}
              {has(a.evaluation) && <li><b>평가</b>{short(String(a.evaluation), 60)}</li>}
              {has(a.schedule) && <li><b>일정</b>{a.schedule.slice(0, 3).map((x) => short(x, 40)).join(" · ")}</li>}
            </ul>
          </section>
        </div>
      )}

      {r && !an.working && <section className="rp-files">
        <H>첨부 문서</H>
        <Files files={b.files || []} detailUrl={b.url} loading={an.working} />
        {fs.length > 0 && (
          <ul className="fstat">
            {fs.map((x, i) => (
              <li key={i} className={/읽음/.test(x.status) ? "ok" : "ng"}>
                <span>{/읽음/.test(x.status) ? "✓" : "✕"}</span>{x.name} — {x.status}
              </li>
            ))}
          </ul>
        )}
      </section>}

      {r && !an.working && <footer className="rp-foot">
        <span className="rp-src">
          {a?.sources?.length ? `분석 근거: ${a.sources.join(", ")}` : r ? "첨부를 읽지 못해 공고 정보로만 판단" : ""}
          {r && <button className="mini" onClick={() => an.retry(true)} disabled={an.working}>{an.working ? "다시 분석하는 중" : "다시 분석"}</button>}
        </span>
        <Stamps bid={b} onUpdate={onUpdate} an={an} say={say} section={section} />
      </footer>}
    </article>
  );
}

function Stamps({ bid: b, onUpdate, an, say, section }) {
  // 신규 공고: 검토만 (누르면 분석 시작)
  if (section === "bids") {
    return (
      <div className="stamps solo" aria-label="검토">
        <button className="stamp review" title="검토·분석으로 보내고 리스크·원가 분석 시작"
          onClick={() => { onUpdate(b.key, { status: "review" }); say("검토·분석으로 옮겨 분석을 시작합니다. 분석이 끝나면 참여·불참을 고르세요."); an.retry(false); }}>
          검토
        </button>
        <span className="stamp-hint">누르면 분석</span>
      </div>
    );
  }
  return (
    <div className="stamps" aria-label="검토 상태">
      {STAMPS.filter(([id]) =>
        // 검토·분석: 참여·불참 / 참여: 참여(해제)·불참
        id !== "review"
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
          <span>{clientOf(b)}{/조달청/.test(b.org || "") && b.demand_org ? " (조달청 대행)" : ""}</span>
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
