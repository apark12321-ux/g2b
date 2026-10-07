"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { at, dday, money, when } from "@/components/format";

const TABS = [
  ["all", "전체"],
  ["new", "신규"],
  ["review", "검토 중"],
  ["join", "참여"],
  ["pass", "패스"],
];
const STAMPS = [
  ["review", "검토"],
  ["join", "참여"],
  ["pass", "패스"],
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
  const [tab, setTab] = useState("new");
  const [rule, setRule] = useState("");
  const [q, setQ] = useState("");
  const [hideClosed, setHideClosed] = useState(true);
  const [showLow, setShowLow] = useState(false); // 영상 비중 낮은 공고 보기
  const [focus, setFocus] = useState(null);
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("bid");
    if (k) setFocus(k);
  }, []);
  const [collecting, setCollecting] = useState(false);
  const [toast, setToast] = useState(null);

  const say = (text, bad) => {
    setToast({ text, bad });
    setTimeout(() => setToast(null), 3500);
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
    const needs = (b) => !tried[b.key] && !failed[b.key] && (focus === b.key || !soon(b)) && (!b.analysis || !b.analysis.video || !(b.files || []).length);
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
    setTab("all");
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
        (!hideClosed || !b.close_at || new Date(b.close_at).getTime() > now) &&
        (!words.length || words.every((w) => nz(`${b.title}${b.org || ""}${b.demand_org || ""}`).includes(w)))
    );
    // 교수설계+영상 공고를 맨 위로
    const p = (b) => (b.analysis?.video?.priority ? 0 : 1);
    return list.map((b, i) => [b, i]).sort((x, y) => p(x[0]) - p(y[0]) || x[1] - y[1]).map((x) => x[0]);
  }, [data, rule, q, hideClosed, showLow, focus]);
  const lowCount = useMemo(() => (data ? data.bids.filter((b) => b.analysis?.video?.low).length : 0), [data]);

  const counts = useMemo(() => {
    const c = { all: base.length, new: 0, review: 0, join: 0, pass: 0 };
    base.forEach((b) => c[b.status]++);
    return c;
  }, [base]);

  const shown = tab === "all" ? base : base.filter((b) => b.status === tab);
  const run = data?.lastRun;

  return (
    <>
      <div className="top">
        <div>
          <h1>입찰 공고</h1>
          {run && (
            <div className={`run ${run.error ? "bad" : ""}`}>
              {run.error
                ? `마지막 수집 실패 (${at(run.ran_at)}): ${run.error}`
                : `마지막 수집 ${at(run.ran_at)}, 공고 ${run.fetched}건 확인, 새 알림 ${run.sent}건${run.failed ? `, 알림 실패 ${run.failed}건` : ""}`}
            </div>
          )}
        </div>
      </div>

      {data?.topic && <Subscribe topic={data.topic} say={say} />}

      <div className="filters">
        <div className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}<span className="n">{counts[id]}</span>
            </button>
          ))}
        </div>
        <input className="field search" type="search" placeholder="모인 공고에서 찾기 (공고명·기관)" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} />
          마감 지난 공고 숨기기
        </label>
      </div>

      {loadErr && <div className="empty"><strong>목록을 불러오지 못했습니다</strong>{loadErr}</div>}
      {!data && !loadErr && <div className="empty">불러오는 중</div>}

      {data && !shown.length && (
        <div className="empty">
          {data.bids.length ? (
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
        {shown.map((b) => <BidRow key={b.key} bid={b} onUpdate={update} focused={focus === b.key}
            an={{ working: working === b.key, error: failed[b.key], retry: (force) => analyze(b.key, force) }} />)}
      </div>

      <footer className="page-foot">
        10분마다 자동으로 수집합니다.
        <button className="foot-link" onClick={collect} disabled={collecting}>{collecting ? "수집 중" : "수동 수집"}</button>
      </footer>

      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`} role="status">{toast.text}</div>}
    </>
  );
}

function Subscribe({ topic, say }) {
  const copy = async () => {
    await navigator.clipboard.writeText(topic).catch(() => {});
    say("채널 이름을 복사했습니다.");
  };
  return (
    <section className="panel subscribe">
      <h2>휴대폰으로 알림 받기</h2>
      <p className="sub-how">
        휴대폰에 <b>ntfy</b> 앱을 설치하고, 앱에서 <b>+</b>를 눌러 아래 채널 이름을 구독하세요.
        구독할 때 <b>대기 상태에서 즉시 알림받기</b>만 체크하세요.
      </p>
      <div className="topic-box">
        <code>{topic}</code>
        <button className="btn" onClick={copy}>복사</button>
      </div>
    </section>
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

function Analysis({ bid: b, an }) {
  const a = b.analysis;

  if (!a) {
    if (an.error) {
      return (
        <div className="an-wait an-err">
          공고를 분석하지 못했습니다: {an.error}{" "}
          <button className="mini" onClick={() => an.retry(false)}>다시 시도</button>
        </div>
      );
    }
    return (
      <div className="an-wait">
        <span className={an.working ? "dot on" : "dot"} aria-hidden />
        {an.working ? "첨부파일을 읽고 공고를 분석하는 중입니다" : "분석 대기 중"}
      </div>
    );
  }

  const has = (x) => (Array.isArray(x) ? x.length > 0 : !!x && x !== "문서에 없음");
  const list = (items) => <ul>{items.filter((x) => has(x)).map((x, i) => <li key={i}>{x}</li>)}</ul>;
  const staff = (a.staff || []).filter((x) => has(x?.role));
  const anything = ["tasks", "deliverables", "period", "eligibility", "evaluation", "presentation", "schedule", "cautions"].some((k) => has(a[k])) || staff.length > 0;
  if (!anything && a.mode === "basic") return null;

  const short = (x, n = 70) => (x.length > n ? x.slice(0, n - 1) + "…" : x);
  const meta = [
    has(a.period) && ["기간", a.period.replace(/^\S*기간\s*[:：]?\s*/, "")],
    staff.length > 0 && ["인력", staff.map((x) => short(has(x.detail) ? `${x.role}(${x.detail})` : x.role, 40)).join(", ")],
    has(a.eligibility) && ["자격", a.eligibility.slice(0, 2).map((x) => short(x)).join(" / ")],
    has(a.evaluation) && ["평가", short(a.evaluation, 90)],
    has(a.schedule) && ["일정", a.schedule.slice(0, 2).join(" / ")],
  ].filter(Boolean);

  return (
    <div className="analysis">
      {has(a.summary) && !/AI 요약 아님|찾지 못했습니다/.test(a.summary) && <p className="an-sum">{a.summary}</p>}
      <div className="an-main">
        <div>
          <h4>하는 일</h4>
          {has(a.tasks) ? list(a.tasks.slice(0, 6)) : <p className="na">문서에서 찾지 못함</p>}
        </div>
        <div>
          <h4>최종 납품물</h4>
          {has(a.deliverables) ? list(a.deliverables.slice(0, 6)) : <p className="na">문서에서 찾지 못함</p>}
        </div>
      </div>
      {has(a.presentation) && (
        <div className="an-present">
          <h4>발표 조건</h4>
          {list(a.presentation.slice(0, 4))}
        </div>
      )}
      {meta.length > 0 && (
        <dl className="an-meta">
          {meta.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}
      <div className="an-foot">
        <button className="mini" onClick={() => an.retry(true)} disabled={an.working}>{an.working ? "다시 분석하는 중" : "다시 분석"}</button>
      </div>
    </div>
  );
}

function BidRow({ bid: b, onUpdate, an, focused }) {
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
          {b.analysis?.video?.priority && <span className="prio">교수설계+영상</span>}
          {revised && <span className="revised">정정</span>}
          {b.title}
        </a>
        <div className="meta">
          <span>{b.org || "-"}{b.demand_org && b.demand_org !== b.org ? ` (수요 ${b.demand_org})` : ""}</span>
          <span className="price" title={b.price ? `${b.price.toLocaleString("ko-KR")}원` : ""}>{money(b.price)}</span>
          <span>마감 {when(b.close_at)}</span>
          <span>게시 {at(b.posted_at)}</span>
        </div>
        <div className="chips">
          {b.keywords.map((k) => <span key={k} className="chip by-rule">{k}</span>)}
        </div>

        <Files files={b.files || []} detailUrl={b.url} loading={an.working} />
        <Analysis bid={b} an={an} />
      </div>

      <div className="stamps" aria-label="검토 상태">
        {STAMPS.map(([id, label]) => {
          const on = b.status === id;
          return (
            <button
              key={id} className={`stamp ${id} ${on ? "on" : ""}`} aria-pressed={on}
              title={on ? `${label} 해제` : `${label}(으)로 표시`}
              onClick={() => onUpdate(b.key, { status: on ? "new" : id })}
            >
              {label}
            </button>
          );
        })}
      </div>
    </article>
  );
}
