// PYJ 모노그램 로고 — P(크게, 아래) · Y(작게, 위) · J(아래로 내려옴)를 엇갈려 쌓은 형태
// tone: "brand"(남색 글자) | "white"(파란 배경 위)
export function PyjMark({ size = 72, color = "currentColor" }) {
  return (
    <svg width={size} height={size * 0.82} viewBox="0 0 120 98" aria-hidden="true" focusable="false">
      <g style={{ fill: color }} fontFamily="'Pretendard Variable', Pretendard, 'Helvetica Neue', Arial, sans-serif" fontWeight="800">
        <text x="10" y="82" fontSize="72">P</text>
        <text x="50" y="44" fontSize="48">Y</text>
        <text x="70" y="94" fontSize="72">J</text>
      </g>
    </svg>
  );
}

export default function PyjLogo({ tone = "brand", size = 72, sub = "WORKS" }) {
  return (
    <span className={`pyj pyj-${tone}`}>
      <PyjMark size={size} color={tone === "white" ? "#fff" : "var(--pyj, #3a3a9e)"} />
      {sub && <span className="pyj-sub">{sub}</span>}
    </span>
  );
}
