// 업무 포인트: 이 공고가 '무슨 일을 얼마나' 요구하는지 비율(%)로 나눔
// 후미디어 기준 — 영상 제작은 바로 가능, 교수설계는 인력·선투자 부담이 큼

const nz = (s) => String(s || "").replace(/\s+/g, "");

export const WORK_KINDS = [
  { key: "video", label: "영상 제작", hint: "촬영·편집·모션·자막",
    re: /(영상|동영상|촬영|편집|모션그래픽|모션|애니메이션|자막|성우|내레이션|나레이션|더빙|인코딩|쇼츠|클립|브이로그|스튜디오|카메라|조명|짐벌|드론)/ },
  { key: "isd", label: "교수설계", hint: "교수설계·원고·스토리보드·평가문항",
    re: /(교수설계|교수-학습설계|교수학습설계|학습설계|ISD|스토리보드|구성안|대본|시나리오|원고|집필|교안|내용설계|학습목표|평가문항|형성평가|퀴즈|차시설계|커리큘럼|교육과정개발)/i },
  { key: "dev", label: "개발·탑재", hint: "HTML5·플랫폼 탑재·시스템",
    re: /(HTML5|웹퍼블리싱|퍼블리싱|프로그래밍|개발사이트|플랫폼|LMS|학습관리|시스템|서버|탑재|업로드|연동|API|앱개발|홈페이지|반응형|상호작용)/i },
  { key: "ops", label: "교육 운영", hint: "연수·강사·행사 운영",
    re: /(교육운영|연수운영|과정운영|학습자관리|수강관리|강사섭외|강사비|튜터|멘토|행사|워크숍운영|설명회운영|모집|홍보운영)/ },
  { key: "etc", label: "교재·기타", hint: "교재·인쇄·번역·조사",
    re: /(교재|워크북|보조교재|인쇄|제본|책자|번역|외국어|수어|화면해설|실태조사|설문|연구보고서|컨설팅)/ },
];

/**
 * 업무 포인트 산정
 *  a: 분석 결과(tasks·deliverables·qty·scope), docText: 문서 전체
 *  → { mix: [{key,label,hint,pct}], top, topLabel, basis }
 */
export function workMix(bid = {}, a = {}, docText = "") {
  const lines = [
    ...(a.tasks || []),
    ...(a.deliverables || []),
    ...(a.qty || []),
    ...String(a.scope || "").split(/\s*[,，;]\s*(?![^()]*\))/),
  ].map(nz).filter((x) => x.length >= 4);

  const score = Object.fromEntries(WORK_KINDS.map((k) => [k.key, 0]));
  let basis = "";

  // ① 과업·납품물 줄 단위 (가장 믿을 만함) — 한 줄이 여러 업무에 걸치면 나눠서 셈
  if (lines.length >= 3) {
    for (const l of lines) {
      const hit = WORK_KINDS.filter((k) => k.re.test(l));
      if (!hit.length) continue;
      for (const k of hit) score[k.key] += 1 / hit.length;
    }
    basis = `과업·납품물 ${lines.length}개 항목 기준`;
  }

  // ② 줄이 적거나 아무것도 안 걸리면 문서 전체 단어 수로
  const total0 = Object.values(score).reduce((t, x) => t + x, 0);
  if (total0 < 1) {
    const doc = nz(docText);
    if (doc.length >= 500) {
      for (const k of WORK_KINDS) score[k.key] = (doc.match(new RegExp(k.re.source, "gi")) || []).length;
      basis = "제안요청서 전체 언급 횟수 기준";
    } else {
      // ③ 문서가 없으면 공고명으로만
      const t = nz(bid.title);
      for (const k of WORK_KINDS) if (k.re.test(t)) score[k.key] += 1;
      basis = "공고명 기준 (문서 미확인)";
    }
  }

  const total = Object.values(score).reduce((t, x) => t + x, 0);
  if (!total) return null;

  let mix = WORK_KINDS
    .map((k) => ({ key: k.key, label: k.label, hint: k.hint, pct: Math.round((score[k.key] / total) * 100) }))
    .filter((x) => x.pct > 0)
    .sort((x, y) => y.pct - x.pct);
  // 반올림 오차를 가장 큰 항목에서 보정
  const diff = 100 - mix.reduce((t, x) => t + x.pct, 0);
  if (mix.length && diff) mix[0].pct += diff;
  mix = mix.filter((x) => x.pct > 0);

  const get = (k) => mix.find((x) => x.key === k)?.pct || 0;
  return {
    mix, basis,
    video: get("video"), isd: get("isd"), dev: get("dev"), ops: get("ops"), etc: get("etc"),
    top: mix[0]?.key || null, topLabel: mix[0]?.label || null,
  };
}

/**
 * 선투자(선금) 가능 여부 — 대금 조건에서 판단
 *  → { level: "가능"|"일부"|"불가"|"미확인", why, pct }
 */
export function prepayLevel(payment) {
  const p = payment || {};
  if (p.advance?.has) return { level: "가능", pct: p.advance.pct || null, why: p.advance.text || "문서에 선금 조항 있음" };
  if (p.advance && p.advance.has === false) return { level: "불가", why: p.advance.text || "문서에 선금 미지급 명시" };
  if (p.progress) return { level: "일부", why: p.progress.text || "기성(중간 지급) 조항 있음" };
  if (p.documented) return { level: "불가", why: "지급 조건은 있으나 선금·기성 조항 없음 (완료 후 지급)" };
  return { level: "미확인", why: "읽은 문서에 대금 지급 조건이 없음" };
}

/**
 * 후미디어가 이 일을 감당할 수 있는가
 *  영상 제작은 바로 가능 / 교수설계는 인력·선투자 부담 → 선금이 있으면 감당 가능
 *  → { fit: "좋음"|"보통"|"부담", headline, note, delta(점수 가감), reasons[] }
 */
export function capacityFit(wm, pre) {
  if (!wm) return null;
  const items = [];              // [{ n: 점수, why: 설명 }]
  const push = (n, why) => items.push({ n, why });
  const canPrepay = pre?.level === "가능";
  const partPrepay = pre?.level === "일부";

  // 영상 제작: 바로 투입 가능한 주력 업무
  if (wm.video >= 60) push(20, `영상 제작 ${wm.video}% (주력 업무, 바로 투입 가능)`);
  else if (wm.video >= 35) push(10, `영상 제작 ${wm.video}%`);
  else if (wm.video < 15) push(-15, `영상 제작 ${wm.video}% (주력 업무 비중 낮음)`);

  // 교수설계: 인력 부족·선투자 불가 → 선금이 있어야 감당
  if (wm.isd >= 40) {
    if (canPrepay) push(5, `교수설계 ${wm.isd}%지만 선금${pre.pct ? ` ${pre.pct}%` : ""}이 있어 인력 투입 가능`);
    else if (partPrepay) push(-8, `교수설계 ${wm.isd}% · 선금 없음(기성만) — 인력 선투입 부담`);
    else push(-18, `교수설계 ${wm.isd}% · 선금 없음 — 인력 부족·선투자 불가`);
  } else if (wm.isd >= 20 && !canPrepay && !partPrepay) {
    push(-6, `교수설계 ${wm.isd}% · 선금 없음`);
  }

  if (wm.dev >= 30) push(-8, `개발·탑재 ${wm.dev}% (외주 필요)`);
  if (wm.ops >= 30) push(-10, `교육 운영 ${wm.ops}% (상시 인력 필요)`);

  const delta = items.reduce((t, x) => t + x.n, 0);
  const fit = delta >= 10 ? "좋음" : delta >= -8 ? "보통" : "부담";
  const headline =
    fit === "좋음" ? `${wm.topLabel} 중심 — 후미디어 주력 업무`
    : fit === "보통" ? `${wm.topLabel} 중심 — 조건 확인 후 판단`
    : `${wm.topLabel} 중심 — 인력·선투자 부담 큼`;
  const note = canPrepay
    ? `선금${pre.pct ? ` ${pre.pct}%` : ""}이 있어 인력을 먼저 투입할 수 있습니다.`
    : partPrepay ? "기성(중간 지급)만 있어 초기 인건비는 자체 부담입니다."
    : pre?.level === "미확인" ? "대금 조건이 문서에 없어 선금 가능 여부를 확인해야 합니다."
    : "선금이 없어 완료까지 인건비를 자체 부담해야 합니다.";
  return { fit, headline, note, delta, items, canPrepay };
}
