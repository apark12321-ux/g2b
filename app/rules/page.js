"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/api";

const randomTopic = () =>
  "bid-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);

const toForm = (r) => ({ ...r, include: r.include.join(", "), exclude: r.exclude.join(", ") });
const words = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

export default function Rules() {
  const [rules, setRules] = useState(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null);

  const say = (text, bad) => {
    setToast({ text, bad });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    api("/api/rules").then((r) => setRules(r.map(toForm))).catch((e) => setErr(e.message));
  }, []);

  const addRule = () =>
    setRules((rs) => [
      { id: null, tmp: Date.now(), name: "", topic: randomTopic(), include: "", exclude: "", active: true },
      ...rs,
    ]);

  const replace = (oldRule, next) => setRules((rs) => rs.map((r) => (r === oldRule ? next : r)));
  const remove = (rule) => setRules((rs) => rs.filter((r) => r !== rule));

  return (
    <>
      <div className="top">
        <div>
          <h1>알림 규칙</h1>
          <div className="run">담당자는 ntfy 앱에서 규칙의 채널 이름을 구독하면 알림을 받습니다.</div>
        </div>
        <button className="btn primary" onClick={addRule} disabled={!rules}>규칙 추가</button>
      </div>

      {err && <div className="empty"><strong>규칙을 불러오지 못했습니다</strong>{err}</div>}
      {rules && !rules.length && (
        <div className="empty"><strong>등록된 규칙이 없습니다</strong>규칙 추가를 눌러 첫 키워드를 등록하세요.</div>
      )}

      <div className="rules">
        {rules?.map((r) => (
          <RuleCard key={r.id ?? r.tmp} rule={r} say={say}
            onSaved={(next) => replace(r, toForm(next))} onRemoved={() => remove(r)} />
        ))}
      </div>

      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`} role="status">{toast.text}</div>}
    </>
  );
}

function RuleCard({ rule, say, onSaved, onRemoved }) {
  const isNew = !rule.id;
  const [editing, setEditing] = useState(isNew);
  const [f, setF] = useState(rule);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const save = async (patch) => {
    const next = { ...f, ...patch };
    setBusy(true);
    try {
      const body = JSON.stringify({ name: next.name, topic: next.topic, include: next.include, exclude: next.exclude, active: next.active });
      const saved = isNew
        ? await api("/api/rules", { method: "POST", body })
        : await api(`/api/rules/${rule.id}`, { method: "PATCH", body });
      onSaved(saved);
      setF(toForm(saved));
      setEditing(false);
      say(patch ? (saved.active ? "알림을 켰습니다." : "알림을 껐습니다.") : "규칙을 저장했습니다.");
    } catch (e) {
      say(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await api(`/api/rules/${rule.id}/test`, { method: "POST" });
      say("테스트 알림을 보냈습니다. 휴대폰을 확인하세요.");
    } catch (e) {
      say(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (isNew) return onRemoved();
    if (!confirm(`'${rule.name}' 규칙을 삭제할까요?`)) return;
    try {
      await api(`/api/rules/${rule.id}`, { method: "DELETE" });
      onRemoved();
      say("규칙을 삭제했습니다.");
    } catch (e) {
      say(e.message, true);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(rule.topic).catch(() => {});
    say("채널 이름을 복사했습니다.");
  };

  // ---------- 보기 모드
  if (!editing) {
    const inc = words(rule.include);
    const exc = words(rule.exclude);
    return (
      <section className={`rule-row ${rule.active ? "" : "off"}`}>
        <div className="rule-main">
          <div className="rule-title">
            <strong>{rule.name}</strong>
            {!rule.active && <span className="off-tag">꺼짐</span>}
          </div>
          <div className="chips">
            {inc.map((k) => <span key={k} className="chip by-rule">{k}</span>)}
          </div>
          {exc.length > 0 && <div className="rule-sub">제외: {exc.join(", ")}</div>}
          <div className="rule-sub">
            채널 <code>{rule.topic}</code>
            <button className="mini" onClick={copy}>복사</button>
          </div>
        </div>
        <div className="rule-btns">
          <label className="switch" title="알림 켜기·끄기">
            <input type="checkbox" checked={rule.active} disabled={busy} onChange={(e) => save({ active: e.target.checked })} />
            알림
          </label>
          <button className="btn" onClick={() => { setF(rule); setEditing(true); }}>수정</button>
          <button className="btn" onClick={test} disabled={busy}>테스트</button>
        </div>
      </section>
    );
  }

  // ---------- 수정 모드
  return (
    <section className="rule">
      <label className="lbl">규칙 이름</label>
      <input className="field full" placeholder="예: 이러닝 콘텐츠" value={f.name} onChange={set("name")} autoFocus={isNew} />

      <div className="grid2" style={{ marginTop: 12 }}>
        <div>
          <label className="lbl">이 단어가 공고명에 있으면 알림</label>
          <textarea className="field full" placeholder="이러닝, 영상 콘텐츠, 교수설계" value={f.include} onChange={set("include")} />
        </div>
        <div>
          <label className="lbl">이 단어가 있으면 제외 (선택)</label>
          <textarea className="field full" placeholder="CCTV, 유지보수" value={f.exclude} onChange={set("exclude")} />
        </div>
      </div>
      <div className="hint">쉼표로 구분해 여러 개 적을 수 있습니다.</div>

      <div style={{ marginTop: 12 }}>
        <label className="lbl">알림 채널 (ntfy에서 구독할 이름)</label>
        <div className="topic-row">
          <input className="field" value={f.topic} onChange={set("topic")} />
          <button className="btn" onClick={() => setF({ ...f, topic: randomTopic() })} type="button">새로 만들기</button>
        </div>
      </div>

      <div className="rule-actions">
        <button className="btn primary" onClick={() => save()} disabled={busy}>{isNew ? "규칙 등록" : "저장"}</button>
        <button className="btn" onClick={() => (isNew ? onRemoved() : setEditing(false))}>취소</button>
        <span className="grow" />
        {!isNew && <button className="btn danger" onClick={del}>규칙 삭제</button>}
      </div>
    </section>
  );
}
