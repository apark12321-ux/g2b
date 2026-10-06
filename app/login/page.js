"use client";
import { useState } from "react";
import { api } from "@/components/api";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password: pw }) });
      window.location.href = "/";
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="brand-seal" aria-hidden>입</div>
      <h1>나라장터 입찰 알림</h1>
      <form onSubmit={submit}>
        <input
          className="field" type="password" placeholder="팀 비밀번호" autoFocus
          value={pw} onChange={(e) => setPw(e.target.value)} aria-label="비밀번호"
        />
        <button className="btn primary" disabled={busy || !pw}>{busy ? "확인 중" : "들어가기"}</button>
        <div className="err" role="alert">{err}</div>
      </form>
    </div>
  );
}
