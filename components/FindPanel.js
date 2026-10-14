"use client";
// 찾기: 내 키워드 관리 + 나라장터 공고 바로 검색 + 업무구분별 주요 키워드
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

function WordBox({ title, hint, words, placeholder, onAdd, onRemove, tone }) {
  const [v, setV] = useState("");
  const add = () => { const w = clean(v); if (w) { onAdd(w); setV(""); } };
  return (
    <div className="kw-box">
      <div className="kw-head"><b>{title}</b>{hint && <small>{hint}</small>}</div>
      <div className="kw-chips">
        {words.map((w) => (
          <span key={w} className={`kw-chip ${tone || ""}`}>
            {w}
            <button type="button" aria-label={`${w} 삭제`} onClick={() => onRemove(w)}>×</button>
          </span>
        ))}
        {!words.length && <span className="kw-empty">아직 없습니다</span>}
      </div>
      <form className="kw-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="field" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} maxLength={30} enterKeyHint="done" />
        <button className="btn" type="submit" disabled={!clean(v)}>추가</button>
      </form>
    </div>
  );
}

export default function FindPanel({ say, onChanged }) {
  const [set, setSet] = useState(null); // { include, exclude, kinds }
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState("servc");
  const [trend, setTrend] = useState({}); // kind → { popular, recent }
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null); // { q, kind, items } | null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { api("/api/keywords").then(setSet).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if (trend[kind]) return;
    api(`/api/trending?kind=${kind}`).then((t) => setTrend((m) => ({ ...m, [kind]: t }))).catch(() => {});
  }, [kind, trend]);

  const save = useCallback(async (patch, msg) => {
    setSaving(true);
    try {
      const r = await api("/api/keywords", { method: "PUT", body: JSON.stringify(patch) });
      setSet({ include: r.include || [], exclude: r.exclude || [], kinds: r.kinds || [] });
      say(r.added?.length ? `${msg}${r.filled ? ` — 최근 30일 공고 ${r.filled}건을 입찰 공고에 담았습니다` : " — 최근 30일에는 맞는 공고가 없었습니다"}` : msg);
      onChanged?.();
    } catch (e) { say(`저장하지 못했습니다: ${e.message}`, true); }
    finally { setSaving(false); }
  }, [say, onChanged]);

  const has = (list, w) => list.some((x) => x.replace(/\s/g, "") === w.replace(/\s/g, ""));
  const addInclude = (w) => set && !has(set.include, w) && save({ include: [...set.include, w] }, `'${w}' 키워드를 등록했습니다`);
  const removeInclude = (w) => save({ include: set.include.filter((x) => x !== w) }, `'${w}' 키워드를 지웠습니다`);
  const addExclude = (w) => set && !has(set.exclude, w) && save({ exclude: [...set.exclude, w] }, `'${w}'가 들어간 공고는 빼겠습니다`);
  const removeExclude = (w) => save({ exclude: set.exclude.filter((x) => x !== w) }, `제외어 '${w}'를 지웠습니다`);
  const toggleKind = (k) => {
    const cur = set.kinds || [];
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    save({ kinds: next }, next.length ? `${next.map((x) => LABEL[x]).join("·")} 공고만 모읍니다` : "모든 종류의 공고를 모읍니다");
  };

  const search = async (word = q, k = kind) => {
    const w = clean(word);
    if (!w) return;
    setQ(w); setBusy(true); setErr("");
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(w)}&kind=${k}&days=30`);
      setRes({ q: w, kind: k, items: r.items || [] });
    } catch (e) { setErr(e.message); setRes(null); }
    finally { setBusy(false); }
  };

  const keep = async (row) => {
    try {
      await api("/api/search/save", { method: "POST", body: JSON.stringify({ row, keyword: res?.q }) });
      setRes((r) => ({ ...r, items: r.items.map((x) => (x.key === row.key ? { ...x, saved: "review" } : x)) }));
      say("검토·분석에 담았습니다. 첨부 문서 분석을 시작합니다.");
      onChanged?.();
    } catch (e) { say(`담지 못했습니다: ${e.message}`, true); }
  };

  const t = trend[kind];
  return (
    <div className="find">
      <section className="find-card">
        <h3>내 키워드 <small>공고명에 이 단어가 들어간 새 공고를 10분마다 모으고 알려 드립니다</small></h3>
        {!set ? <div className="empty">불러오는 중</div> : (
          <>
            <WordBox title="찾을 단어" hint="하나라도 들어 있으면 모읍니다" words={set.include}
              placeholder="예: 청소, 홍보영상, 태양광" onAdd={addInclude} onRemove={removeInclude} />
            <WordBox title="뺄 단어" hint="이 단어가 들어간 공고는 모으지 않습니다" words={set.exclude} tone="ex"
              placeholder="예: 유지보수, 임차" onAdd={addExclude} onRemove={removeExclude} />
            <div className="kw-box">
              <div className="kw-head"><b>모을 공고 종류</b><small>아무것도 고르지 않으면 전부 모읍니다</small></div>
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

      <section className="find-card">
        <h3>나라장터에서 찾기 <small>최근 30일 공고 · 마감 전인 것만</small></h3>
        <div className="type-tabs" role="tablist" aria-label="공고 종류">
          {KINDS.map((k) => (
            <button key={k.key} role="tab" aria-selected={kind === k.key} className={kind === k.key ? "on" : ""}
              onClick={() => { setKind(k.key); if (res?.q) search(res.q, k.key); }}>{k.label}</button>
          ))}
        </div>
        <form className="find-bar" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="field search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={`${LABEL[kind]} 공고명으로 찾기`} enterKeyHint="search" />
          <button className="btn primary" type="submit" disabled={busy || !clean(q)}>{busy ? "찾는 중" : "찾기"}</button>
        </form>

        <div className="pop">
          <div className="pop-row">
            <span className="pop-label">많이 찾는 키워드</span>
            <div className="pop-chips">
              {(t?.popular || []).map((w) => <button key={w} type="button" onClick={() => search(w)}>{w}</button>)}
            </div>
          </div>
          {(t?.recent || []).length > 0 && (
            <div className="pop-row">
              <span className="pop-label">이틀간 많이 올라온 말</span>
              <div className="pop-chips">
                {t.recent.map(({ w, n }) => <button key={w} type="button" onClick={() => search(w)}>{w}<span>{n}</span></button>)}
              </div>
            </div>
          )}
        </div>

        {err && <div className="empty"><strong>찾지 못했습니다</strong>{err}</div>}
        {res && (
          <div className="find-res">
            <div className="find-res-head">
              <b>‘{res.q}’ {LABEL[res.kind]} 공고 {res.items.length}건</b>
              {set && !has(set.include, res.q)
                ? <button className="mini" type="button" disabled={saving} onClick={() => addInclude(res.q)}>이 단어로 알림 받기</button>
                : <span className="kw-on">알림 받는 키워드</span>}
            </div>
            {!res.items.length ? <div className="empty">마감 전인 공고가 없습니다. 다른 종류(용역·물품·공사·외자)도 눌러 보세요.</div> : (
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
                        : <button className="btn" type="button" onClick={() => keep(b)}>검토에 담기</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
