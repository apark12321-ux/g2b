// 공고 성격 분류 — 목록을 나누는 기준
// 원칙: 억지로 쪼개지 않는다. 실제로 '일하는 방식'이 달라지는 선에서만 가른다.
//   · 교수설계가 섞이면 인력·선투자 부담이 생기므로 영상 단독과 갈라야 한다
//   · 홍보영상은 교육물과 제작 공정·검수 방식이 다르므로 갈라야 한다
//   · 개발·탑재, 교육 운영이 주력이면 우리 일이 아닐 수 있어 갈라야 한다
//   · 그 밖에는 모두 한 칸에 묶는다

export const WORK_TYPES = [
  { key: "video",     label: "영상 제작",    hint: "촬영·편집 위주, 교수설계 부담 없음" },
  { key: "isd_video", label: "교수설계＋영상", hint: "설계와 제작을 함께 요구" },
  { key: "isd",       label: "교수설계",     hint: "설계·원고가 주력" },
  { key: "promo",     label: "홍보영상",     hint: "기관·사업 홍보물" },
  { key: "dev",       label: "개발·탑재",    hint: "플랫폼·시스템 비중이 큼" },
  { key: "ops",       label: "교육 운영",    hint: "연수·강사·행사 운영" },
  { key: "etc",       label: "기타",         hint: "위 어디에도 뚜렷이 속하지 않음" },
];

export const TYPE_LABEL = Object.fromEntries(WORK_TYPES.map((t) => [t.key, t.label]));
export const TYPE_HINT = Object.fromEntries(WORK_TYPES.map((t) => [t.key, t.hint]));

const PROMO = /(홍보|브랜드|캠페인|바이럴|프로모션|기관\s*소개|사업\s*소개|스케치\s*영상|행사\s*영상|광고|CF|SNS|숏폼|쇼츠)/;
const EDU = /(교육|이러닝|e-?러닝|학습|강의|연수|차시|교수|훈련|직무|교과|과정\s*개발|콘텐츠\s*개발)/i;
const T_VIDEO = /(영상|동영상|촬영|편집|모션|애니메이션|자막|성우|내레이션|나레이션|더빙)/;
const T_ISD = /(교수설계|학습설계|ISD|스토리보드|구성안|대본|원고|집필|교안|평가문항|커리큘럼|교육과정\s*개발)/i;
const T_DEV = /(LMS|학습관리|플랫폼|시스템|탑재|웹\s*구축|홈페이지|앱\s*개발|HTML5|퍼블리싱)/i;
const T_OPS = /(운영\s*용역|교육\s*운영|연수\s*운영|과정\s*운영|강사|튜터|멘토|행사\s*운영)/;

/** 공고 하나를 성격 한 가지로 분류 — 분석이 있으면 업무 포인트(%)를, 없으면 제목을 쓴다 */
export function workType(bid = {}) {
  const title = String(bid.title || "");
  const mix = Object.fromEntries((bid.analysis?.workMix?.mix || []).map((m) => [m.key, m.pct || 0]));
  const analyzed = (bid.analysis?.workMix?.mix || []).length > 0;

  // 홍보물은 교육물과 아예 다른 일 — 제목이 가장 확실한 단서
  if (PROMO.test(title) && !EDU.test(title)) return "promo";

  if (!analyzed) {
    // 분석 전: 제목만으로 거칠게 나눈다 (분석이 끝나면 저절로 제자리를 찾음)
    const v = T_VIDEO.test(title), i = T_ISD.test(title) || /교육|이러닝|e-?러닝|차시/i.test(title);
    if (v && i) return "isd_video";
    if (v) return "video";
    if (i) return "isd";
    if (T_DEV.test(title)) return "dev";
    if (T_OPS.test(title)) return "ops";
    return "etc";
  }

  const v = mix.video || 0, i = mix.isd || 0, d = mix.dev || 0, o = mix.ops || 0;
  if (i >= 25 && v >= 25) return "isd_video"; // 둘 다 무시 못 할 비중
  if (d >= 40) return "dev";
  if (o >= 40) return "ops";
  if (v >= 50) return "video";
  if (i >= 50) return "isd";
  if (v >= 30 && v >= i) return "video";
  if (i > v) return "isd";
  return "etc";
}

/**
 * 목록을 성격별로 센다. 화면에 띄울 만한 것만 돌려준다.
 *  · 한 종류뿐이면 나눌 이유가 없으므로 빈 배열 (탭 줄을 아예 숨김)
 *  · 칸이 다섯을 넘으면 작은 것부터 '기타'로 합쳐 넷까지만 남긴다
 */
export function typeBuckets(list = []) {
  const n = new Map();
  for (const b of list) { const k = workType(b); n.set(k, (n.get(k) || 0) + 1); }
  if (n.size <= 1) return [];

  if (n.size > 5) {
    const keep = new Set([...n].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k]) => k));
    for (const [k, c] of [...n]) {
      if (!keep.has(k)) { n.delete(k); n.set("etc", (n.get("etc") || 0) + c); }
    }
  }
  if (n.size <= 1) return [];

  return WORK_TYPES.filter((t) => n.get(t.key)).map((t) => ({ ...t, n: n.get(t.key) }));
}

/** 합쳐진 뒤의 최종 소속 — typeBuckets가 남긴 칸에 맞춘다 */
export function bucketOf(bid, buckets) {
  const k = workType(bid);
  return buckets.some((t) => t.key === k) ? k : "etc";
}
