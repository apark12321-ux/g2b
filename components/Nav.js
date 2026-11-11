import Link from "next/link";

// 나라장터 화면 구성(상단 이용 줄 + 로고 줄 + 파란 메뉴 줄)을 따른 머리 영역 — 공식 로고·정부 상징은 쓰지 않음
const G2B = "https://www.g2b.go.kr";

export default function Nav() {
  return (
    <header className="nav">
      <div className="nav-util">
        <div className="nav-in">
          <nav className="util-tabs" aria-label="바로가기">
            <Link href="/" className="on">입찰알림</Link>
            <a href={G2B} target="_blank" rel="noreferrer">나라장터</a>
            <a href="https://www.data.go.kr" target="_blank" rel="noreferrer">공공데이터포털</a>
          </nav>
          <div className="util-pills">
            <a className="pill solid" href={G2B} target="_blank" rel="noreferrer">나라장터 바로가기</a>
          </div>
        </div>
      </div>
      <div className="nav-main">
        <div className="nav-in">
          <Link href="/" className="brand">
            <span className="brand-seal" aria-hidden>입</span>
            <span className="brand-txt">
              <span className="brand-name">입찰알림</span>
              <span className="brand-sub">나라장터 용역 공고 실시간 알림 · 검토</span>
            </span>
          </Link>
          <div className="nav-pills">
            <a className="pill line" href={`${G2B}`} target="_blank" rel="noreferrer">입찰공고 원문</a>
          </div>
        </div>
      </div>
    </header>
  );
}
