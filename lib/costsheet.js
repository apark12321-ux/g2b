// 발주처 원가 산출내역(과업내역서·산출내역서·원가계산서)에서 투입 인력(MM)과 비목별 금액을 찾음
const num = (s) => Number(String(s).replace(/[,\s원]/g, "")) || 0;

/** text: 문서 전체(엑셀은 행 단위로 탭 구분) → { mm, grades, labor, direct, overhead, techFee, total, found } */
export function parseCostSheet(text) {
  const lines = String(text || "").split(/\n+/).map((l) => l.replace(/[ \u00a0]+/g, " ").trim()).filter(Boolean);
  const out = { mm: 0, grades: {}, labor: 0, direct: 0, overhead: 0, techFee: 0, total: 0, found: false };
  const GRADE = /(기술사|특급|고급|중급|초급)\s*(?:기술자|숙련기술자)?/;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // 1) 등급별 투입 MM: "중급기술자  2  인  6  개월" / "고급 1.5 M/M" / "초급기술자 3.0 인월"
    const g = l.match(GRADE);
    if (g) {
      // 같은 줄에서 먼저 찾고, 없으면(표가 칸마다 줄바꿈된 HWP) 바로 다음 두 줄까지 봄
      const pick = (txt) => {
        const pm = txt.match(/([\d.]+)\s*(?:인|명)\D{0,6}?([\d.]+)\s*(?:개월|월)(?!\s*\d+\s*일)/);
        if (pm) return Number(pm[1]) * Number(pm[2]);
        const d = txt.match(/([\d.]+)\s*(?:M\/M|MM|M·M|인\s*[·.]?\s*월|인월)/i);
        return d ? Number(d[1]) : 0;
      };
      let mm = pick(l);
      if (!mm && !GRADE.test(lines[i + 1] || "")) mm = pick(`${l} ${lines[i + 1] || ""} ${GRADE.test(lines[i + 2] || "") ? "" : lines[i + 2] || ""}`);
      if (mm > 0 && mm < 200) {
        out.grades[g[1]] = (out.grades[g[1]] || 0) + mm;
        out.mm += mm;
      }
    }
    // 2) 비목별 금액
    const amt = () => { const m = l.match(/([\d]{1,3}(?:,\d{3})+|\d{6,})\s*원?\s*$/) || l.match(/([\d]{1,3}(?:,\d{3}){2,})/); return m ? num(m[1]) : 0; };
    if (/(직접\s*인건비|인건비|노무비)\s*(소계|계|합계)?/.test(l) && !out.labor) out.labor = amt();
    else if (/직접\s*경비/.test(l) && !out.direct) out.direct = amt();
    else if (/제\s*경비/.test(l) && !out.overhead) out.overhead = amt();
    else if (/기술\s*료/.test(l) && !out.techFee) out.techFee = amt();
    else if (/(총\s*계|총\s*합계|사업비\s*(?:총액|합계|계)|총\s*용역비|총\s*사업비)/.test(l) && !out.total) out.total = amt();
  }
  out.mm = Math.round(out.mm * 10) / 10;
  out.found = out.mm >= 1 || out.labor > 0;
  return out;
}
