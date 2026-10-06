import Link from "next/link";

export default function Nav() {
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <span className="brand-seal" aria-hidden>입</span>
        <span>나라장터 입찰 알림</span>
      </Link>
    </header>
  );
}
