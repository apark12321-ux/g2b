"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "./api";

export default function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  const logout = async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };
  return (
    <header className="nav">
      <Link href="/" className="brand">
        <span className="brand-seal" aria-hidden>입</span>
        <span className="brand-text">나라장터 입찰 알림</span>
      </Link>
      <nav className="nav-links">
        <Link href="/" className={path === "/" ? "on" : ""}>공고</Link>
        <Link href="/rules" className={path === "/rules" ? "on" : ""}>키워드</Link>
        <button className="link-btn" onClick={logout}>로그아웃</button>
      </nav>
    </header>
  );
}
