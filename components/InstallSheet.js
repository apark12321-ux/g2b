"use client";
// 모바일 첫 접속 시 아래에서 올라오는 앱 설치 안내
//  · 안드로이드 크롬: 버튼 한 번으로 설치 (beforeinstallprompt)
//  · 아이폰 사파리: 공유 → 홈 화면에 추가 안내
//  · 이미 앱으로 실행 중이거나 '나중에'를 누르면 띄우지 않음 (카톡에서 넘어온 경우는 다시 띄움)
import { useEffect, useState } from "react";

const KEY = "install-sheet-off";
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(KEY, v); } catch {} },
};

export default function InstallSheet() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const mobile = /Android|iPhone|iPad|iPod/i.test(ua);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
    const inapp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|DaumApps|BAND\/| Line\//i.test(ua);
    if (!mobile || standalone || inapp) return;
    setIos(/iPhone|iPad|iPod/i.test(ua));
    const fromInapp = new URLSearchParams(location.search).get("from") === "inapp";
    const h = (e) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener("beforeinstallprompt", h);
    const done = () => { setShow(false); store.set("installed"); };
    window.addEventListener("appinstalled", done);
    // 첫 화면(파란 화면)이 지나간 뒤 올림
    const t = setTimeout(() => { if (fromInapp || !store.get()) setShow(true); }, 1800);
    return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", h); window.removeEventListener("appinstalled", done); };
  }, []);

  if (!show) return null;
  const close = () => { setShow(false); store.set("later"); };
  return (
    <div className="isheet" role="dialog" aria-label="앱 설치">
      <div className="isheet-card">
        <b>앱으로 설치</b>
        <p>홈 화면에서 바로 열기 · 새 공고 알림 받기</p>
        {prompt ? (
          <button className="btn primary isheet-go" onClick={async () => { prompt.prompt(); const r = await prompt.userChoice; if (r?.outcome === "accepted") store.set("installed"); setShow(false); }}>설치</button>
        ) : ios ? (
          <p className="isheet-how">Safari 아래 <b>공유(□↑)</b> → <b>홈 화면에 추가</b></p>
        ) : (
          <p className="isheet-how">Chrome 오른쪽 위 <b>⋮</b> → <b>앱 설치</b> (또는 홈 화면에 추가)</p>
        )}
        <button className="isheet-later" onClick={close}>나중에</button>
      </div>
    </div>
  );
}
