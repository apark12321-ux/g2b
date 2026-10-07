// 문서에서 공동수급·제안서 작성 형식을 '찾을 수 있는 만큼 다' 찾아 원문 그대로 정리

const cut = (x, n = 200) => { const t = String(x || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** 공동수급(공동계약·공동도급) 관련 조항 → { status, quotes } */
export function jointInfo(lines) {
  const rel = lines.filter((l) => /공동\s*(?:수급|계약|도급)/.test(l) && !/(공동\s*활용|공동\s*저작|공동\s*연구|공동\s*이용)/.test(l));
  if (!rel.length) return null;
  // '공동수급체 이외의 인력 투입 불허'처럼 인력에 관한 문장은 공동수급 허용 여부가 아님
  const aboutStaff = (l) => /(인력|이외|투입|구성원을?\s*변경|부정당|재직)/.test(l);
  const no = rel.find((l) => !aboutStaff(l) && (/공동\s*(?:수급|계약|도급)[^.]{0,25}(불허|불가|허용하지\s*않|금지|제한)/.test(l) || /(단독|개별)\s*(?:으로|업체만|입찰만)[^.]{0,15}(참가|입찰)/.test(l)));
  const yes = rel.find((l) => !aboutStaff(l) && /공동\s*(?:수급|계약|도급)[^.]{0,25}(허용|가능|할\s*수\s*있)/.test(l));
  const implied = rel.find((l) => /(공동\s*수급\s*체|공동\s*수급\s*구성원|공동\s*수급\s*협정|분담\s*이행|공동\s*이행|대표\s*사)/.test(l));
  const status = no ? "불허" : yes ? "허용" : implied ? "허용 (공동수급체 관련 조항 있음)" : "관련 조항 있음";
  const rank = (l) => (l === no || l === yes ? 0 : /(공동\s*수급\s*체|구성원|협정|분담|공동\s*이행)/.test(l) ? 1 : /(법률|운용\s*요령|준용)/.test(l) ? 3 : 2);
  const quotes = [...new Set([no, yes, ...rel].filter(Boolean))].sort((a, b) => rank(a) - rank(b)).slice(0, 5).map((l) => cut(l));
  return { status, quotes };
}

/** 제안서 작성·제출 형식 → { summary, quotes } */
export function formatInfo(lines) {
  // 제안서(요약서·발표 자료)에 대한 문장 중 형식 표현이 있는 것만
  const fmt = lines.filter((l) =>
    /(제안서|제안\s*요약서|발표\s*자료|제안\s*발표)/.test(l) &&
    /(A4|A3|종방향|횡방향|세로\s*(?:방향|형|로\s*작성)|가로\s*(?:방향|형|로\s*작성)|글자\s*크기|폰트|글꼴|쪽\s*번호|일련\s*번호|페이지\s*(?:이내|이하|제한)|쪽\s*(?:이내|이하)|매\s*이내|부\s*(?:제출|작성)|USB|PDF|HWP|양면|단면|제본|분량|한글\s*작성)/.test(l) &&
    !/(학습\s*페이지|웹\s*페이지|화면\s*크기|영상\s*크기|MP4|HTML|교재)/.test(l));
  if (!fmt.length) return null;
  const all = fmt.join(" ");
  const parts = [];
  const paper = all.match(/A[34]/); if (paper) parts.push(paper[0]);
  const v = /(종방향|세로\s*방향|세로형|세로로\s*작성)/.test(all), h = /(횡방향|가로\s*방향|가로형|가로로\s*작성)/.test(all);
  if (v && h) {
    const vFirst = /(종방향|세로)[^.]{0,20}(원칙|작성)/.test(all);
    parts.push(vFirst ? "세로(종방향) 원칙 · 일부 가로(횡방향) 허용" : "가로(횡방향) · 세로(종방향) 언급 — 원문 확인");
  } else if (v) parts.push("세로(종방향)");
  else if (h) parts.push("가로(횡방향)");
  const pg = all.match(/(\d{1,3})\s*(?:쪽|페이지|매)\s*(?:이내|이하|내외)/); if (pg) parts.push(`${pg[1]}쪽 이내`);
  const fs = all.match(/(?:글자\s*크기|폰트\s*크기|글꼴\s*크기)[^.\d]{0,10}(\d{1,2})\s*(?:pt|포인트)?/); if (fs) parts.push(`글자 ${fs[1]}pt`);
  if (/특이한?\s*폰트[^.]{0,10}금지|폰트[^.]{0,15}금지/.test(all)) parts.push("특이 폰트 금지");
  if (/(쪽\s*번호|일련\s*번호)/.test(all)) parts.push("쪽번호 표기");
  const copies = all.match(/(\d{1,2})\s*부\s*(?:제출|작성)/); if (copies) parts.push(`${copies[1]}부`);
  if (/PDF/.test(all)) parts.push("PDF"); if (/HWP|한글\s*파일/.test(all)) parts.push("HWP");
  const score = (l) => (/(A4|A3|종방향|횡방향|방향)/.test(l) ? 0 : /(폰트|글꼴|글자\s*크기|쪽)/.test(l) ? 1 : 2);
  return { summary: parts.length ? parts.join(" · ") : "작성 형식 조항 있음 (원문 참고)", quotes: [...fmt].sort((a, b) => score(a) - score(b)).slice(0, 5).map((l) => cut(l)) };
}
