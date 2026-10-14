// 업무구분별 주요 키워드
//  popular : 나라장터 이용자가 많이 찾는 대표 검색어 (기본 목록)
//  recent  : 최근 며칠간 실제로 많이 올라온 공고명 낱말 (나라장터 공고 목록에서 셈)
import { fetchBids } from "./g2b";
import { db } from "./supabase";

export const POPULAR = {
  servc: ["청소", "경비", "시설관리", "홍보영상", "교육", "행사", "설계", "감리", "연구", "컨설팅",
    "소프트웨어", "유지보수", "콘텐츠", "디자인", "번역", "조사", "방역", "급식", "운송", "폐기물"],
  thng: ["컴퓨터", "노트북", "복합기", "사무용품", "가구", "의자", "소모품", "의료기기", "차량", "전기차",
    "CCTV", "태블릿", "서버", "방송장비", "체육용품", "식품", "피복", "소화기", "드론", "LED"],
  cnstwk: ["전기", "통신", "소방", "기계설비", "조경", "도로", "포장", "건축", "리모델링", "방수",
    "도장", "태양광", "하수관", "상수도", "철거", "석면", "내진보강", "냉난방", "승강기", "정보통신"],
  frgcpt: ["연구장비", "분석장비", "의료장비", "계측기", "현미경", "시약", "소프트웨어", "부품", "실험장비", "측정장비"],
};

// 공고명에 늘 붙는 말·기관명 꼬리는 키워드가 아니다
const STOP = new Set(["용역", "사업", "구매", "입찰", "공사", "제작", "설치", "및", "등", "관련", "연간", "단가", "계약",
  "단가계약", "긴급", "재공고", "정정", "위탁", "운영", "관리", "지원", "추진", "개선", "보수", "정비", "기타", "외", "건",
  "협상", "일반", "제한", "총액", "공동", "지역", "추가", "변경", "신규", "임차", "물품", "용품", "공고", "실시",
  "개발", "업체", "선정", "기반", "활용", "조성", "기념", "수립", "보급", "계획", "기술", "학기", "중등", "초등", "구축",
  "서비스", "사용", "이용", "대상", "분야", "부문", "내", "용도", "연도", "상반기", "하반기", "분기", "희망", "참여"]);
const ORG = /(특별시|광역시|특별자치|[시군구]청?|도청|대학교|학교|센터|공단|재단|연구원|박물관|도서관|병원|본부|사업소|소방서|경찰서|교육청|교육지원청|사무소|위원회|공사|공기업|진흥원|관리원|평가원|협회|청사)$/;

export function wordsOf(title) {
  return String(title || "")
    .replace(/\[[^\]]*\]|\([^)]*\)|<[^>]*>/g, " ")
    .split(/[\s·,/·\-_~"'「」『』]+/)
    .map((w) => w.replace(/^(20\d{2}년?도?|\d+차?년?도?|제\d+)/, "").replace(/(용역|사업|구매|공사|제작|설치|입찰|운영|관리)$/, ""))
    .filter((w) => /^[가-힣A-Za-z0-9]{2,10}$/.test(w) && !/^\d+$/.test(w) && !STOP.has(w) && !ORG.test(w)
      && !/[가-힣](의|은|는|을|를|로|에|한|던|된|할|와|과)$/.test(w) || /^(교육|영상|전기|기계|조경|청소)$/.test(w));
}

/** 최근 공고명에서 많이 나온 낱말 (12시간 캐시) */
export async function recentWords(kind = "servc", top = 15) {
  const supa = db();
  const cacheKey = `trending_${kind}`;
  try {
    const { data } = await supa.from("app_settings").select("value").eq("key", cacheKey).maybeSingle();
    if (data?.value) {
      const c = JSON.parse(data.value);
      if (Date.now() - c.at < 12 * 3600e3 && Array.isArray(c.words)) return c.words;
    }
  } catch {}
  const items = await fetchBids(48, "1", kind);
  const count = new Map();
  for (const it of items) for (const w of new Set(wordsOf(it.bidNtceNm))) count.set(w, (count.get(w) || 0) + 1);
  const words = [...count.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, top).map(([w, n]) => ({ w, n }));
  try { await supa.from("app_settings").upsert({ key: cacheKey, value: JSON.stringify({ at: Date.now(), words }) }); } catch {}
  return words;
}
