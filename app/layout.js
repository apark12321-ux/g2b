import "./globals.css";
import Nav from "@/components/Nav";

export const metadata = {
  title: "나라장터 입찰 알림",
  description: "키워드에 맞는 나라장터 용역 공고를 모아 보고 담당자에게 알립니다.",
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#2F4A9E" };

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        <Nav />
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
