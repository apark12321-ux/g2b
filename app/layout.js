import "./globals.css";
import Nav from "@/components/Nav";
import RegisterSW from "@/components/RegisterSW";
import PyjLogo from "@/components/PyjLogo";
import InstallSheet from "@/components/InstallSheet";

// 카카오톡·인스타 등 앱 안 브라우저 → 외부 브라우저(안드로이드 크롬 / 아이폰 사파리)로 넘김
// 앱 안에서는 알림·앱 설치가 안 되기 때문. 페이지 그리기 전에 바로 실행되도록 head에 넣음
const INAPP = `(function(){try{
var ua=navigator.userAgent||"",href=location.href;
var kakao=/KAKAOTALK/i.test(ua),line=/ Line\\//i.test(ua);
var inapp=kakao||line||/NAVER\\(inapp|Instagram|FBAN|FBAV|DaumApps|BAND\\//i.test(ua);
if(!inapp)return;
var android=/Android/i.test(ua);
var u=href+(href.indexOf("?")<0?"?":"&")+"from=inapp";
var chrome="intent://"+u.replace(/^https?:\\/\\//,"")+"#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url="+encodeURIComponent(u)+";end";
var ext=kakao?"kakaotalk://web/openExternal?url="+encodeURIComponent(u):line?u+"&openExternalBrowser=1":android?chrome:"";
window.__inapp={android:android,ext:ext,url:u};
function show(){if(document.querySelector(".inapp"))return;
var d=document.createElement("div");d.className="inapp";
var go=android?chrome:ext;
d.innerHTML='<div class="inapp-card"><b>외부 브라우저에서 열기</b><p>카카오톡 안에서는 알림·앱 설치 불가</p>'+(go?'<a class="btn primary" href="'+go+'">'+(android?"크롬으로 열기":"사파리로 열기")+'</a>':"")+'<button type="button" class="btn" id="inapp-copy">주소 복사</button><button type="button" class="inapp-skip" id="inapp-skip">그냥 보기</button></div>';
document.body.appendChild(d);
document.getElementById("inapp-skip").onclick=function(){d.remove();};
document.getElementById("inapp-copy").onclick=function(){var b=this;(navigator.clipboard?navigator.clipboard.writeText(href):Promise.reject()).then(function(){b.textContent="복사 완료 · 브라우저에 붙여넣기";},function(){prompt("주소를 복사하세요",href);});};
if(ext)setTimeout(function(){location.href=ext;},300);}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",show);else show();
}catch(e){}})();`;

export const metadata = {
  title: "나라장터 입찰알림",
  description: "키워드에 맞는 나라장터 용역 공고를 모아 보고 담당자에게 알립니다.",
  applicationName: "입찰 알림",
  appleWebApp: { capable: true, title: "입찰 알림", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#245BEB" };

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard: 한글·영문·숫자가 고르게 깔끔한 화면용 서체 */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <script dangerouslySetInnerHTML={{ __html: INAPP }} />
      </head>
      <body>
        {/* 첫 화면: 파란 화면이 아주 잠시 보인 뒤 사라짐 (CSS만으로 동작 — 스크립트 로딩 전에도 보임) */}
        <div className="splash" aria-hidden="true">
          <div className="splash-title"><span>입찰</span><span>알림</span></div>
          <div className="splash-foot"><PyjLogo tone="white" size={44} /></div>
        </div>
        <RegisterSW />
        <InstallSheet />
        <Nav />
        <main className="wrap">{children}</main>
        {/* 제작자 표기 */}
        <footer className="corp"><PyjLogo size={48} /></footer>
      </body>
    </html>
  );
}
