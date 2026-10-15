"use client";
// 찾기: 내 키워드 관리 + 나라장터 공고 바로 검색 + 업무구분별 주요 키워드
// 문구는 짧은 음슴체로
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { money, dday, at } from "@/components/format";

const KINDS = [
  { key: "servc", label: "용역" },
  { key: "thng", label: "물품" },
  { key: "cnstwk", label: "공사" },
  { key: "frgcpt", label: "외자" },
];
const LABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 30);

function WordBox({ title, hint, words, placeholder, onAdd, onRemove, tone, pending = {}, onRetry }) {
  const [v, setV] = useState("");
  const add = () => { const w = clean(v); if (w) { onAdd(w); setV(""); } };
  return (
    <div className="kw-box">
      <div className="kw-head"><b>{title}</b>{hint && <small>{hint}</small>}</div>
      <div className="kw-chips">
        {words.map((w) => (
          <span key={w} className={`kw-chip ${tone || ""}`}>
            {w}
            {pending[w] === "busy" && <em className="kw-busy">수집 중</em>}
            {pending[w] === "late" && <button type="button" className="kw-retry" onClick={() => onRetry?.(w)}>다시 시도</button>}
            <button type="button" aria-label={`${w} 삭제`} onClick={() => onRemove(w)}>×</button>
          </span>
        ))}
        {!words.length && <span className="kw-empty">없음</span>}
      </div>
      <form className="kw-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="field" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} maxLength={30} enterKeyHint="done" />
        <button className="btn" type="submit" disabled={!clean(v)}>추가</button>
      </form>
    </div>
  );
}

export default function FindPanel({ say, onChanged, onFound }) {
  const [set, setSet] = useState(null); // { include, exclude, kinds }
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState("servc");
  const [trend, setTrend] = useState({}); // kind → { popular, recent }
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null); // { q, kind, items } | null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState({}); // 단어 → "busy"(최근 30일 공고 수집 중) | "late"(3번 해도 안 됨)

  useEffect(() => { api("/api/keywords").then(setSet).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if (trend[kind]) return;
    api(`/api/trending?kind=${kind}`).then((t) => setTrend((m) => ({ ...m, [kind]: t }))).catch(() => {});
  }, [kind, trend]);

  /* 새 단어의 최근 30일 공고 채우기 — 나라장터가 느리면 못 끝낸 조합만 다시 (최대 3번).
     3번 해도 남으면 실패라고 하지 않고 '다시 시도' 버튼만 남긴다 (10분마다 수집은 그대로 돎) */
  const fill = useCallback(async (words) => {
    setPending((p) => ({ ...p, ...Object.fromEntries(words.map((w) => [w, "busy"])) }));
    let pairs = null, filled = 0;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await api("/api/keywords/fill", { method: "POST", body: JSON.stringify({ words, pairs }) });
        filled += r.filled || 0;
        if (r.filled) onChanged?.();
        pairs = r.failed || [];
        if (!pairs.length) break;
      } catch { pairs = pairs || null; }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    const left = new Set((pairs === null ? words.map((w) => [w]) : pairs).map(([w]) => w));
    setPending((p) => {
      const n = { ...p };
      for (const w of words) { if (left.has(w)) n[w] = "late"; else delete n[w]; }
      return n;
    });
    const name = words.map((w) => `'${w}'`).join(", ");
    if (left.size) say(`나라장터 응답 지연 · ${name} 최근 공고는 연결되는 대로 자동 수집${filled ? ` (${filled}건 수집됨)` : ""}`);
    else say(`${name} 최근 30일 공고 ${filled ? `${filled}건 수집` : "없음 · 새 공고부터 알림"}`);
    if (filled) onFound?.(); // 모은 공고가 있으면 입찰 공고 탭으로 바로 이동
  }, [say, onChanged, onFound]);

  const save = useCallback(async (patch, msg) => {
    setSaving(true);
    setSet((cur) => (cur ? { ...cur, ...patch } : cur)); // 누르자마자 화면에 반영
    try {
      const r = await api("/api/keywords", { method: "PUT", body: JSON.stringify(patch) });
      setSet({ include: r.include || [], exclude: r.exclude || [], kinds: r.kinds || [] });
      say(msg);
      onChanged?.();
      if (r.added?.length) fill(r.added); // 저장은 끝, 최근 공고 채우기는 뒤에서
    } catch (e) {
      say(`저장 지연 · 잠시 후 다시 시도`, true);
      api("/api/keywords").then(setSet).catch(() => {}); // 저장된 상태로 되돌림
    }
    finally { setSaving(false); }
  }, [say, onChanged, fill]);

  const has = (list, w) => list.some((x) => x.replace(/\s/g, "") === w.replace(/\s/g, ""));
  const addInclude = (w) => set && !has(set.include, w) && save({ include: [...set.include, w] }, `'${w}' 등록 완료`);
  const removeInclude = (w) => save({ include: set.include.filter((x) => x !== w) }, `'${w}' 삭제`);
  const addExclude = (w) => set && !has(set.exclude, w) && save({ exclude: [...set.exclude, w] }, `제외어 '${w}' 등록`);
  const removeExclude = (w) => save({ exclude: set.exclude.filter((x) => x !== w) }, `제외어 '${w}' 삭제`);
  const toggleKind = (k) => {
    const cur = set.kinds || [];
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    save({ kinds: next }, next.length ? `${next.map((x) => LABEL[x]).join("·")}만 수집` : "전체 종류 수집");
  };

  const search = async (word = q, k = kind) => {
    const w = clean(word);
    if (!w) return;
    setQ(w); setBusy(true); setErr(""); setRes(null);
    // 나라장터가 느리면 조용히 다시 (최대 3번) — 그래도 안 되면 다시 검색 안내
    for (let i = 0; i < 3; i++) {
      try {
        const r = await api(`/api/search?q=${encodeURIComponent(w)}&kind=${k}&days=30`);
        setRes({ q: w, kind: k, items: r.items || [] });
        setBusy(false);
        // 결과가 보이도록 결과 카드로 이동
        requestAnimationFrame(() => document.querySelector(".find-out")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      } catch { if (i < 2) await new Promise((ok) => setTimeout(ok, 1500)); }
    }
    setErr("나라장터 응답 지연 · 잠시 후 다시 검색");
    setBusy(false);
  };

  const keep = async (row) => {
    try {
      await api("/api/search/save", { method: "POST", body: JSON.stringify({ row, keyword: res?.q }) });
      setRes((r) => ({ ...r, items: r.items.map((x) => (x.key === row.key ? { ...x, saved: "review" } : x)) }));
      say("검토 담기 완료 · 첨부 분석 시작");
      onChanged?.();
    } catch (e) { say("담기 지연 · 잠시 후 다시 시도", true); }
  };

  const t = trend[kind];
  return (
    <div className="find">
      <section className="find-card find-hero">
        <h3><span className="hero-kick">나라장터 공고 검색</span>원하는 단어로 바로 찾기<small>최근 30일 · 마감 전 공고만</small></h3>
        <div className="type-tabs" role="tablist" aria-label="공고 종류">
          {KINDS.map((k) => (
            <button key={k.key} role="tab" aria-selected={kind === k.key} className={kind === k.key ? "on" : ""}
              onClick={() => { setKind(k.key); if (res?.q) search(res.q, k.key); }}>{k.label}</button>
          ))}
        </div>
        <form className="find-bar" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="field search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={`${LABEL[kind]} 공고명 검색`} enterKeyHint="search" />
          <button className="btn primary" type="submit" disabled={busy || !clean(q)}>{busy ? "검색 중" : "검색"}</button>
        </form>

        <div className="pop">
          <div className="pop-row">
            <span className="pop-label">인기 키워드</span>
            <div className="pop-chips">
              {(t?.popular || []).map((w) => <button key={w} type="button" onClick={() => search(w)}>{w}</button>)}
            </div>
          </div>
          {(t?.recent || []).length > 0 && (
            <div className="pop-row">
              <span className="pop-label">오늘 많이 나온 단어</span>
              <div className="pop-chips">
                {t.recent.map(({ w, n }) => <button key={w} type="button" onClick={() => search(w)}>{w}<span>{n}</span></button>)}
              </div>
            </div>
          )}
        </div>
      </section>
      {(busy || err || res) && (
        <section className="find-card find-out">
        {busy && <div className="find-busy" role="status"><span className="dot on" aria-hidden />‘{q}’ {LABEL[kind]} 공고 검색 중</div>}
        {err && <div className="empty">{err}</div>}
        {res && !busy && (
          <div className="find-res">
            <div className="find-res-head">
              <b>‘{res.q}’ {LABEL[res.kind]} 공고 {res.items.length}건</b>
              {set && !has(set.include, res.q)
                ? <button className="mini" type="button" disabled={saving} onClick={() => addInclude(res.q)}>알림 등록</button>
                : <span className="kw-on">알림 등록됨</span>}
            </div>
            {!res.items.length ? <div className="empty">마감 전 공고 없음 · 다른 종류(용역·물품·공사·외자)도 확인</div> : (
              <ul className="find-list">
                {res.items.map((b) => (
                  <li key={b.key}>
                    <a href={b.url} target="_blank" rel="noreferrer" className="find-title">{b.title}</a>
                    <div className="find-meta">
                      <span>{b.demand_org || b.org || "-"}</span>
                      <span>{money(b.price)}</span>
                      <span className={dday(b.close_at).tone === "urgent" ? "hot" : ""}>마감 {at(b.close_at)} · {dday(b.close_at).big}</span>
                    </div>
                    <div className="find-act">
                      {b.saved && b.saved !== "pass"
                        ? <span className="kw-on">{b.saved === "join" ? "참여 중" : b.saved === "review" ? "검토 중" : "담긴 공고"}</span>
                        : <button className="btn" type="button" onClick={() => keep(b)}>검토 담기</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        </section>
      )}
      <section className="find-card">
        <h3>내 키워드 <small>공고명 포함 시 10분마다 수집·알림</small></h3>
        {!set ? <div className="empty">불러오는 중</div> : (
          <>
            <WordBox title="포함 단어" hint="하나라도 포함 시 수집" words={set.include} pending={pending} onRetry={(w) => fill([w])}
              placeholder="예: 청소, 홍보영상, 태양광" onAdd={addInclude} onRemove={removeInclude} />
            <WordBox title="제외 단어" hint="포함 시 수집 제외" words={set.exclude} tone="ex"
              placeholder="예: 유지보수, 임차" onAdd={addExclude} onRemove={removeExclude} />
            <div className="kw-box">
              <div className="kw-head"><b>수집 대상</b><small>미선택 시 전체</small></div>
              <div className="type-tabs">
                {KINDS.map((k) => (
                  <button key={k.key} type="button" className={(set.kinds || []).includes(k.key) ? "on" : ""} disabled={saving}
                    aria-pressed={(set.kinds || []).includes(k.key)} onClick={() => toggleKind(k.key)}>{k.label}</button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
