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
        {shown.map((b) => <BidRow key={b.key} bid={b} onUpdate={update} />)}
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
      const fr = document.createElement("iframe");
      fr.style.display = "none";
      fr.src = f.url;
      document.body.appendChild(fr);
      setTimeout(() => fr.remove(), 60_000);
      await new Promise((r) => setTimeout(r, 800));
    }
    setBusy(false);
  };
  return (
    <div className="files">
      {files.map((f) => (
        <a key={f.url} className="file" href={f.url} target="_blank" rel="noreferrer" download title={`${f.name} 받기`}>
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

function BidRow({ bid: b, onUpdate }) {
  const d = dday(b.close_at);
  const [editing, setEditing] = useState(false);
  const [memo, setMemo] = useState(b.memo || "");
  const revised = String(b.bid_ord || "").replace(/0/g, "") !== "";

  const saveMemo = () => {
    setEditing(false);
    if (memo !== (b.memo || "")) onUpdate(b.key, { memo });
  };

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

        {editing ? (
          <textarea
            className="field memo-edit" autoFocus value={memo} placeholder="담당자, 준비 사항 등"
            onChange={(e) => setMemo(e.target.value)} onBlur={saveMemo}
          />
        ) : (
          <>
            {b.memo && <div className="memo-view">{b.memo}</div>}
            <button className="memo-toggle" onClick={() => setEditing(true)}>{b.memo ? "메모 수정" : "메모 남기기"}</button>
          </>
        )}
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
