import Link from "next/link";

export default function Nav() {
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <span className="brand-seal" aria-hidden>입</span>
        <span className="brand-name">나라장터 입찰알림</span>
      </Link>
      <span className="brand-co">(주)후미디어</span>
    </header>
  );
}
