"use client";
// 투찰 기준 카드 — 나라장터 공개값(기초금액·예비가격 범위·낙찰하한율)만으로 계산. 없으면 숫자를 만들지 않음.
// 예정가격 분포는 복수예가 결정 구조(15개 구간 · 4개 추첨 평균)로 정확 계산 (lib/yega.js)
import { useEffect, useMemo, useState } from "react";
import { yegaModel, planAt, floorScenarios, negoPriceTable } from "@/lib/yega";

const pct = (v) => `${v > 0 ? "+" : ""}${v}%`;
const sp = (v, d = 2) => `${(100 + v).toFixed(d)}%`; // 사정률 = 예정가격 ÷ 기초금액
const won = (v) => (v == null ? "-" : `${Math.round(v).toLocaleString("ko-KR")}원`);
const man = (v) => (v == null ? "-" : `${(Math.round(v / 1e3) / 10).toLocaleString("ko-KR")}만원`);
const kindOf = (b) =>
  String((b?.matched_rules || []).find((x) => String(x).startsWith("kind:")) || "kind:servc").slice(5);

/** 가격 배점: 나라장터 값 우선, 없으면 문서 원문 대조값(기술:가격) */
function priceWeightOf(d, bid) {
  if (d?.weight?.price > 0) return { price: d.weight.price, tech: d.weight.tech, src: "나라장터" };
  const tp = bid?.analysis?.keyReview?.evaluation?.techPrice?.value;
  const m = String(tp || "").match(/(\d{1,3}(?:\.\d+)?)\s*[:：]\s*(\d{1,3}(?:\.\d+)?)/);
  if (m && Number(m[1]) + Number(m[2]) === 100) return { tech: Number(m[1]), price: Number(m[2]), src: "제안요청서" };
  return null;
}

/** 예정가격 분포 */
function Dist({ d, model }) {
  const { q } = model;
  const maxP = Math.max(...model.bins.map((x) => x.p));
  return (
    <div className="bp-sec">
      <h5>예정가격 분포 <small>복수예가 15개 · 4개 추첨 평균 · 추첨 번호 무작위 가정</small></h5>
      <div className="bp-q">
        <div><span>중앙값</span><b>{sp(q.p50)}</b><small>{man(planAt(d.bss, q.p50))}</small></div>
        <div><span>50% 구간</span><b>{sp(q.p25)} ~ {sp(q.p75)}</b><small>{man(planAt(d.bss, q.p25))} ~ {man(planAt(d.bss, q.p75))}</small></div>
        <div><span>80% 구간</span><b>{sp(q.p10)} ~ {sp(q.p90)}</b><small>{man(planAt(d.bss, q.p10))} ~ {man(planAt(d.bss, q.p90))}</small></div>
      </div>
      <ul className="bp-bins" aria-label="사정률 구간별 확률">
        {model.bins.map((x) => (
          <li key={x.from}>
            <span className="bp-r">{sp(x.from)} ~ {sp(x.to)}</span>
            <span className="bp-bar"><i style={{ width: `${(x.p / maxP) * 100}%` }} /></span>
            <b>{(x.p * 100).toFixed(1)}%</b>
          </li>
        ))}
      </ul>
      <p className="bp-note">사정률 = 예정가격 ÷ 기초금액 · 공고 범위 {sp(d.range.lo, 0)} ~ {sp(d.range.hi, 0)} · 99% 발생 범위 {sp(model.bins[0].from)} ~ {sp(model.bins[7].to)} · 표준편차 {model.sd.toFixed(2)}%p</p>
    </div>
  );
}

/** 낙찰하한율 공고: 하한 통과 확률별 투찰 금액 + 금액 입력 시 통과 확률 */
function FloorPlan({ d, model }) {
  const sc = useMemo(() => floorScenarios(d.bss, d.lwlt, model), [d.bss, d.lwlt, model]);
  const [v, setV] = useState("");
  if (!sc) return null;
  const amt = Number(String(v).replace(/[^0-9]/g, ""));
  const p = amt > 0 ? sc.passProb(amt) : null;
  return (
    <div className="bp-sec">
      <h5>투찰 금액별 하한 통과 확률 <small>낙찰하한율 {d.lwlt}% · 하한 = 예정가격 × 하한율</small></h5>
      <table className="bp-tb">
        <thead><tr><th>하한 통과</th><th>투찰 금액</th><th>기초금액 대비</th></tr></thead>
        <tbody>
          {sc.rows.map((r) => (
            <tr key={r.pass} className={r.pass >= 1 ? "all" : ""}>
              <td>{r.pass >= 1 ? "항상 통과" : `${Math.round(r.pass * 100)}%`}</td>
              <td>{won(r.amount)}</td>
              <td>{r.rateBss.toFixed(3)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="bp-in">
        <span>투찰 금액 입력</span>
        <input inputMode="numeric" placeholder={won(sc.rows[2].amount)} value={v}
          onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ","))} />
        <b>{p == null ? "-" : `하한 통과 ${(p * 100).toFixed(1)}%`}</b>
      </label>
      <p className="bp-note">낮게 쓸수록 최저가 순위 유리 · 하한 미달 위험 증가 · 적격심사 점수 별도</p>
    </div>
  );
}

/** 협상 계약: 최저가 대비 투찰 차이별 가격점수 */
function NegoPrice({ w, rule }) {
  const tb = negoPriceTable(w.price);
  if (!tb) return null;
  const at5 = tb.find((x) => x.gap === 5);
  return (
    <div className="bp-sec">
      <h5>가격점수 민감도 <small>기술 {w.tech} : 가격 {w.price} · {w.src} 기준</small></h5>
      <table className="bp-tb">
        <thead><tr><th>최저가 대비</th><th>가격점수</th><th>손실</th></tr></thead>
        <tbody>
          {tb.map((r) => (
            <tr key={r.gap}><td>{r.gap ? `+${r.gap}%` : "최저가"}</td><td>{r.score.toFixed(2)}점</td><td>{r.loss ? `−${r.loss.toFixed(2)}점` : "-"}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="bp-note">
        가격점수 = 가격 배점 × 최저 입찰가 ÷ 해당 입찰가 (국가계약 협상 기준 · 추정가격 80% 이상 투찰 시)
        {at5 && ` · 최저가보다 5% 높은 투찰 = 기술점수 ${at5.loss.toFixed(2)}점 차이`}
      </p>
      {rule?.value && (
        <details className="qt"><summary>제안요청서 가격평가 특례 · 산식 우선 적용</summary>{rule.value}{rule.quote && <> · “{rule.quote}” <small>{rule.source}</small></>}</details>
      )}
    </div>
  );
}

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

  // 복수예가일 때만 분포 계산 (단일예가·비예가는 추첨 없음)
  const model = useMemo(
    () => (d?.bss && d?.range && !/단일|비예가/.test(d.priceMethod || "") ? yegaModel(d.range) : null),
    [d?.bss, d?.range?.lo, d?.range?.hi, d?.priceMethod]
  );

  if (!bid?.bid_no || String(bid.key || "").startsWith("TEST-")) return null;
  const w = d ? priceWeightOf(d, bid) : null;
  const rule = bid?.analysis?.keyReview?.evaluation?.priceRule;

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
          {model && <Dist d={d} model={model} />}
          {model && d.floor && <FloorPlan d={d} model={model} />}
          {!d.floor && !d.ceil && d.reasons?.[0] && <p className="bp-why">{d.reasons[0]}{d.weight ? ` · 기술 ${d.weight.tech} : 가격 ${d.weight.price}` : ""}</p>}
        </>
      )}
      {d && d.nego && w && <NegoPrice w={w} rule={rule} />}
      {d && <p className="bp-past">과거 개찰 분석 (실제 사정률·1순위 투찰률·참여 업체 수) · 조달청 낙찰정보서비스 활용신청 후 표시</p>}
    </section>
  );
}
