"use client";
import { useEffect, useState } from "react";
import { api } from "@/components/api";

export default function Keywords() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null);
  const [showExclude, setShowExclude] = useState(false);

  const say = (text, bad) => {
    setToast({ text, bad });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    api("/api/keywords")
      .then((d) => { setS(d); setShowExclude(d.exclude.length > 0); })
      .catch((e) => setErr(e.message));
  }, []);

  const save = async (patch, msg) => {
    const prev = s;
    setS({ ...s, ...patch });
    try {
      setS(await api("/api/keywords", { method: "PUT", body: JSON.stringify(patch) }));
      if (msg) say(msg);
    } catch (e) {
      setS(prev);
      say(`저장하지 못했습니다: ${e.message}`, true);
    }
  };

  const test = async () => {
    try {
      await api("/api/keywords/test", { method: "POST" });
      say("테스트 알림을 보냈습니다. 휴대폰을 확인하세요.");
    } catch (e) {
      say(e.message, true);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(s.topic).catch(() => {});
    say("채널 이름을 복사했습니다.");
  };

  if (err) return <div className="empty"><strong>불러오지 못했습니다</strong>{err}</div>;
  if (!s) return <div className="empty">불러오는 중</div>;

  return (
    <>
      <div className="top">
        <div>
          <h1>키워드</h1>
          <div className="run">공고명에 아래 단어가 들어간 용역 공고가 올라오면 바로 알림을 보냅니다.</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={s.active} onChange={(e) => save({ active: e.target.checked }, e.target.checked ? "알림을 켰습니다." : "알림을 잠시 껐습니다.")} />
          알림 받기
        </label>
      </div>

      <section className="panel">
        <WordBox
          words={s.include}
          placeholder="예: 이러닝, 영상 콘텐츠"
          empty="아직 등록된 키워드가 없습니다. 위에 입력하고 추가를 누르세요."
          onChange={(include, msg) => save({ include }, msg)}
        />

        {showExclude ? (
          <div className="exclude">
            <h2>빼고 싶은 단어</h2>
            <p className="hint">키워드에 걸려도 이 단어가 함께 있으면 알리지 않습니다. 예: 영상 → CCTV</p>
            <WordBox
              words={s.exclude}
              placeholder="예: CCTV, 유지보수"
              empty="없음"
              muted
              onChange={(exclude, msg) => save({ exclude }, msg)}
            />
          </div>
        ) : (
          <button className="mini more" onClick={() => setShowExclude(true)}>빼고 싶은 단어 설정</button>
        )}
      </section>

      <section className="panel subscribe">
        <h2>휴대폰으로 알림 받기</h2>
        <ol>
          <li>휴대폰에 <b>ntfy</b> 앱을 설치합니다.</li>
          <li>앱에서 <b>+</b>를 누르고 아래 채널 이름을 입력해 구독합니다.</li>
          <li>테스트 알림을 눌러 알림이 오는지 확인합니다.</li>
        </ol>
        <div className="topic-box">
          <code>{s.topic}</code>
          <button className="btn" onClick={copy}>복사</button>
          <button className="btn primary" onClick={test}>테스트 알림</button>
        </div>
        <p className="hint">채널 이름을 아는 사람은 누구나 알림을 받을 수 있으니 팀 안에서만 공유하세요.</p>
      </section>

      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`} role="status">{toast.text}</div>}
    </>
  );
}

function WordBox({ words, placeholder, empty, muted, onChange }) {
  const [text, setText] = useState("");

  const add = () => {
    const items = text.split(",").map((x) => x.trim()).filter(Boolean);
    const fresh = items.filter((w) => !words.includes(w));
    setText("");
    if (fresh.length) onChange([...words, ...fresh], `'${fresh.join(", ")}' 추가했습니다.`);
  };

  return (
    <div>
      <div className="word-input">
        <input
          className="field" value={text} placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(); } }}
        />
        <button className="btn" onClick={add} disabled={!text.trim()}>추가</button>
      </div>
      <div className="words">
        {words.length === 0 && <span className="hint">{empty}</span>}
        {words.map((w) => (
          <span key={w} className={`word ${muted ? "muted" : ""}`}>
            {w}
            <button aria-label={`${w} 삭제`} onClick={() => onChange(words.filter((x) => x !== w), `'${w}' 삭제했습니다.`)}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}
