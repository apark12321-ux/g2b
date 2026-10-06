export default function manifest() {
  return {
    name: "나라장터 입찰 알림",
    short_name: "입찰 알림",
    description: "키워드에 맞는 나라장터 용역 공고를 모아 봅니다.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eef1f0",
    theme_color: "#2F4A9E",
    lang: "ko",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
