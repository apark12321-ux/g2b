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

export default function Home() {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [tab, setTab] = useState("all");
  const [rule, setRule] = useState("");
  const [q, setQ] = useState("");
  const [hideClosed, setHideClosed] = useState(true);
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
      say(`수집했습니다. 공고 ${r.fetched}건 중 새 알림 ${r.sent}건`);
      await load();
    } catch (e) {
      say(e.message, true);
      await load();
    } finally {
      setCollecting(false);
    }
  };

  const setAnalysis = (key, analysis) =>
    setData((d) => ({ ...d, bids: d.bids.map((b) => (b.key === key ? { ...b, analysis } : b)) }));

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
    const words = q.trim().toLowerCase();
    const now = Date.now();
    return data.bids.filter(
      (b) =>
        (!rule || b.matched_rules.includes(rule)) &&
        (!hideClosed || !b.close_at || new Date(b.close_at).getTime() > now) &&
        (!words || `${b.title} ${b.org || ""} ${b.demand_org || ""}`.toLowerCase().includes(words))
    );
  }, [data, rule, q, hideClosed]);

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
                : `마지막 수집 ${at(run.ran_at)}, 공고 ${run.fetched}건 확인, 새 알림 ${run.sent}건`}
            </div>
          )}
        </div>
        <button className="btn primary" onClick={collect} disabled={collecting}>
          {collecting ? "수집 중" : "지금 수집"}
        </button>
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
        <input className="field search" type="search" placeholder="공고명, 기관 검색" value={q} onChange={(e) => setQ(e.target.value)} />
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
            <><strong>아직 모인 공고가 없습니다</strong>지금 수집을 누르면 최근 3일 공고부터 모아 옵니다.</>
          )}
        </div>
      )}

      <div className="list">
        {shown.map((b) => <BidRow key={b.key} bid={b} onUpdate={update} onAnalyzed={setAnalysis} say={say} />)}
      </div>

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
      <p className="sub-how">휴대폰에 <b>ntfy</b> 앱을 설치하고, 앱에서 <b>+</b>를 눌러 아래 채널 이름을 구독하세요.</p>
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

function Files({ files, detailUrl }) {
  const [busy, setBusy] = useState(false);
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

function Analysis({ bid: b, onAnalyzed, say }) {
  const [busy, setBusy] = useState(false);
  const a = b.analysis;

  const run = async () => {
    setBusy(true);
    try {
      onAnalyzed(b.key, await api("/api/analyze", { method: "POST", body: JSON.stringify({ key: b.key }) }));
    } catch (e) {
      say(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  if (!a) {
    return (
      <button className="analyze-btn" onClick={run} disabled={busy}>
        {busy ? "첨부파일 읽고 분석하는 중 (30초 정도)" : "공고 분석하기"}
      </button>
    );
  }

  const list = (items) =>
    Array.isArray(items) && items.length ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="na">문서에 없음</p>;
  const fit = a.fit?.level || "";

  return (
    <details className="analysis">
      <summary>
        {fit && <span className={`fit fit-${fit === "상" ? "hi" : fit === "중" ? "mid" : "lo"}`}>적합도 {fit}</span>}
        <span className="sum">{a.summary}</span>
      </summary>
      <div className="an-body">
        {a.fit?.reason && <p className="fit-reason">{a.fit.reason}</p>}
        <h4>주요 업무</h4>{list(a.tasks)}
        <h4>필요 인력</h4>
        {Array.isArray(a.staff) && a.staff.length ? (
          <ul>{a.staff.map((s, i) => <li key={i}><b>{s.role}</b>{s.detail ? ` : ${s.detail}` : ""}</li>)}</ul>
        ) : <p className="na">문서에 없음</p>}
        <h4>납품물</h4>{list(a.deliverables)}
        <h4>사업 기간</h4><p>{a.period || "문서에 없음"}</p>
        <h4>참가 자격</h4>{list(a.eligibility)}
        <h4>평가 방식</h4><p>{a.evaluation || "문서에 없음"}</p>
        <h4>주요 일정</h4>{list(a.schedule)}
        <h4>유의사항</h4>{list(a.cautions)}
        <p className="an-src">
          분석에 사용한 파일: {a.sources?.length ? a.sources.join(", ") : "없음 (공고 정보만으로 분석)"}
          {a.skipped?.length ? ` · 읽지 못한 파일: ${a.skipped.join(", ")}` : ""}
        </p>
        <button className="mini" onClick={run} disabled={busy}>{busy ? "다시 분석하는 중" : "다시 분석"}</button>
      </div>
    </details>
  );
}

function BidRow({ bid: b, onUpdate, onAnalyzed, say }) {
  const d = dday(b.close_at);
  const revised = String(b.bid_ord || "").replace(/0/g, "") !== "";

  return (
    <article className={`bid st-${b.status}`}>
      <div className={`dday ${d.tone}`} title={`입찰마감 ${when(b.close_at)}`}>
        <b>{d.big}</b>
        <small>{d.small || when(b.close_at).replace(/\s\d{2}:\d{2}$/, "")}</small>
      </div>

      <div className="body">
        <a className="title" href={b.url} target="_blank" rel="noreferrer">
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

        <Files files={b.files || []} detailUrl={b.url} />
        <Analysis bid={b} onAnalyzed={onAnalyzed} say={say} />
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
