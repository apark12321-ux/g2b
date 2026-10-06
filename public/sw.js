// 앱 설치용 최소 서비스 워커 (항상 최신 데이터를 서버에서 받음)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
