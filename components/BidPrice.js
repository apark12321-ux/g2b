"use client";
// 투찰 기준 카드 — 나라장터 공개값(기초금액·예비가격 범위·낙찰하한율)만으로 계산. 없으면 숫자를 만들지 않음.
import { useEffect, useState } from "react";

const pct = (v) => `${v > 0 ? "+" : ""}${v}%`;
const won = (v) => (v == null ? "-" : `${Math.round(v).toLocaleString("ko-KR")}원`);
const kindOf = (b) =>
  String((b?.matched_rules || []).find((x) => String(x).startsWith("kind:")) || "kind:servc").slice(5);

export default function BidPrice({ bid, H }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!bid?.bid_no || String(bid.key || "").startsWith("TEST-")) return;
    let off = false;
    setErr("");
    const q = new URLSearchParams({ no: bid.bid_no, ord: bid.bid_ord || "000", kind: kindOf(bid) });
    (async () => {
      for (let i = 0; i < 3 && !off; i++) {
        try {
          const r = await fetch(`/api/bid-price?${q}`);
          const j = await r.json();
          if (r.ok) { if (!off) setD(j); return; }
        } catch {}
        await new Promise((x) => setTimeout(x, 1500 * (i + 1)));
      }
      if (!off) setErr("나라장터 응답 지연");
    })();
    return () => { off = true; };
  }, [bid?.bid_no, bid?.bid_ord, tick]);

  if (!bid?.bid_no || String(bid.key || "").startsWith("TEST-")) return null;

  return (
    <section className="bp">
      <H>투찰 기준 <small className="hs">나라장터 공개값으로 계산 · 추정 없음</small></H>
      {!d && !err && <p className="bp-wait">불러오는 중</p>}
      {err && <p className="bp-wait">{err} · <button type="button" className="linkish" onClick={() => setTick((t) => t + 1)}>다시 불러오기</button></p>}
      {d && !d.bss && (
        <p className="bp-why"><b>{(d.method || d.contract || "낙찰 방법 미기재").split("-")[0]}</b> · {d.reasons?.[0]}{d.weight ? ` · 기술 ${d.weight.tech} : 가격 ${d.weight.price}` : ""}</p>
      )}
      {d && d.bss && (
        <>
          <div className="rp-kpis bp-kpis">
            <div><span>기초금액</span><b>{won(d.bss)}</b><small>{d.priceMethod || "예가 방식 미기재"}</small></div>
            <div><span>예정가격 범위</span><b>{d.plan ? `${pct(d.range.lo)} ~ ${pct(d.range.hi)}` : "-"}</b>
              <small>{d.plan ? `${won(d.plan.min)} ~ ${won(d.plan.max)}` : "예비가격 범위 미공개"}</small></div>
            <div><span>낙찰하한율</span><b>{d.lwlt ? `${d.lwlt}%` : "없음"}</b><small>{(d.method || d.contract || "낙찰 방법 미기재").split("-")[0]}</small></div>
          </div>
          {d.floor && (
            <div className="bp-floor">
              <span>투찰 하한 금액</span>
              <b>{won(d.floor.min)} ~ {won(d.floor.max)}</b>
              <small>예정가격 × 낙찰하한율 · 이 금액 미만이면 하한 미달 · 사정률 100%일 때 {won(d.floor.mid)}</small>
            </div>
          )}
          {d.ceil && (
            <div className="bp-floor">
              <span>투찰 상한 (예정가격 이내)</span>
              <b>{won(d.ceil.safe)} 이하</b>
              <small>이 금액 이하면 어떤 예정가격이 정해져도 예가 이내 · {won(d.ceil.over)} 초과는 항상 예가 초과</small>
            </div>
          )}
          {!d.floor && !d.ceil && d.reasons?.[0] && <p className="bp-why">{d.reasons[0]}{d.weight ? ` · 기술 ${d.weight.tech} : 가격 ${d.weight.price}` : ""}</p>}
        </>
      )}
      {d && <p className="bp-past">과거 개찰 분석 (사정률·경쟁사) · 낙찰정보서비스 연결 후 표시</p>}
    </section>
  );
}
