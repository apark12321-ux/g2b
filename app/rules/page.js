"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/api";

const randomTopic = () =>
  "bid-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);

const toForm = (r) => ({ ...r, include: r.include.join(", "), exclude: r.exclude.join(", ") });

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
          <div className="run">공고명에 포함 키워드가 있고 제외 키워드가 없으면 해당 채널로 알림을 보냅니다.</div>
        </div>
        <button className="btn primary" onClick={addRule} disabled={!rules}>규칙 추가</button>
      </div>

      <div className="guide">
        <p>
          담당자는 휴대폰에 ntfy 앱을 설치하고, 자기 규칙의 알림 채널 이름으로 구독하면 됩니다.
          채널 이름을 아는 사람은 누구나 알림을 받을 수 있으니 추측하기 어려운 이름을 쓰고 팀 안에서만 공유하세요.
        </p>
      </div>

      {err && <div className="empty"><strong>규칙을 불러오지 못했습니다</strong>{err}</div>}
      {rules && !rules.length && (
        <div className="empty"><strong>등록된 규칙이 없습니다</strong>규칙 추가를 눌러 첫 키워드를 등록하세요.</div>
      )}

      {rules?.map((r) => (
        <RuleCard key={r.id ?? r.tmp} rule={r} say={say}
          onSaved={(next) => replace(r, toForm(next))} onRemoved={() => remove(r)} />
      ))}

      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`} role="status">{toast.text}</div>}
    </>
  );
}

function RuleCard({ rule, say, onSaved, onRemoved }) {
  const [f, setF] = useState(rule);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const isNew = !f.id;
  const dirty = JSON.stringify(f) !== JSON.stringify(rule);

  const save = async () => {
    setBusy(true);
    try {
      const body = JSON.stringify({ name: f.name, topic: f.topic, include: f.include, exclude: f.exclude, active: f.active });
      const saved = isNew
        ? await api("/api/rules", { method: "POST", body })
        : await api(`/api/rules/${f.id}`, { method: "PATCH", body });
      onSaved(saved);
      say("규칙을 저장했습니다.");
    } catch (e) {
      say(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await api(`/api/rules/${f.id}/test`, { method: "POST" });
      say("테스트 알림을 보냈습니다. 휴대폰을 확인하세요.");
    } catch (e) {
      say(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (isNew) return onRemoved();
    if (!confirm(`'${f.name}' 규칙을 삭제할까요?`)) return;
    try {
      await api(`/api/rules/${f.id}`, { method: "DELETE" });
      onRemoved();
      say("규칙을 삭제했습니다.");
    } catch (e) {
      say(e.message, true);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(f.topic).catch(() => {});
    say("채널 이름을 복사했습니다.");
  };

  return (
    <section className={`rule ${f.active ? "" : "off"}`}>
      <div className="rule-head">
        <input className="field" placeholder="규칙 이름 (예: 이러닝 콘텐츠)" value={f.name} onChange={set("name")} aria-label="규칙 이름" />
        <label className="switch">
          <input type="checkbox" checked={f.active} onChange={set("active")} /> 사용
        </label>
      </div>

      <div className="grid2">
        <div>
          <label className="lbl">포함 키워드</label>
          <textarea className="field full" placeholder="이러닝, 영상 콘텐츠, 교수설계" value={f.include} onChange={set("include")} />
          <div className="hint">쉼표로 구분합니다. 하나라도 들어 있으면 알립니다. 띄어쓰기는 무시합니다.</div>
        </div>
        <div>
          <label className="lbl">제외 키워드</label>
          <textarea className="field full" placeholder="CCTV, 유지보수" value={f.exclude} onChange={set("exclude")} />
          <div className="hint">하나라도 들어 있으면 알리지 않습니다.</div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="lbl">알림 채널 (ntfy 구독 이름)</label>
        <div className="topic-row">
          <input className="field" value={f.topic} onChange={set("topic")} aria-label="알림 채널" />
          <button className="btn" onClick={copy} type="button">복사</button>
          <button className="btn" onClick={() => setF({ ...f, topic: randomTopic() })} type="button">새로 만들기</button>
        </div>
      </div>

      <div className="rule-actions">
        <button className="btn primary" onClick={save} disabled={busy || (!dirty && !isNew)}>
          {isNew ? "규칙 등록" : "변경 저장"}
        </button>
        {!isNew && (
          <button className="btn" onClick={test} disabled={busy || dirty} title={dirty ? "먼저 변경을 저장하세요" : ""}>
            테스트 알림 보내기
          </button>
        )}
        <span className="grow" />
        <button className="btn danger" onClick={del}>{isNew ? "취소" : "삭제"}</button>
      </div>
    </section>
  );
}
