// 영상 비중 판단: 교수설계+영상 공고는 우선, 영상 비중이 아주 낮은 공고는 걸러냄
const nz = (s) => String(s || "").replace(/\s+/g, "");

export const VIDEO = /(영상|동영상|촬영|편집|모션그래픽|스튜디오|차시|이러닝콘텐츠|강의콘텐츠|교육콘텐츠제작|콘텐츠제작|홍보물영상|인강|강좌제작)/;
export const ISD = /(교수설계|교수-학습설계|교수학습설계|학습설계|ISD|스토리보드|교안설계|내용설계)/i;

// 영상 외 업무(운영·시스템·교재·행사 등)
export const NONVIDEO = /(운영|LMS|학습관리|시스템|플랫폼|홈페이지|앱개발|교재|인쇄|연수|교육과정개발|컨설팅|행사|전시|홍보물|번역|디자인개발|교수설계|ISD|스토리보드)/i;
const PURE = /(영상|동영상|촬영|편집|모션그래픽|애니메이션|홍보영상|강의영상|교육영상)/;

/** 공고명만 보고 '영상 제작만 하는' 공고인지 (분석 전 빠른 판단) */
export const titleVideoOnly = (title) => PURE.test(nz(title)) && !NONVIDEO.test(nz(title));

/** 공고명만 보고 영상 업무가 분명한지 */
export const titleHasVideo = (title) => VIDEO.test(nz(title));

/**
 * bid: 공고, docText: 첨부 문서 전체 글자, result: 분석 결과
 * → { share(0~100|null), isd, video, priority, low }
 */
export function videoProfile(bid, docText, result) {
  const title = nz(bid.title);
  const doc = nz(docText);
  const lines = [...(result.tasks || []), ...(result.deliverables || [])].map(nz).filter(Boolean);
  const mentions = (doc.match(new RegExp(VIDEO.source, "g")) || []).length;

  let share = null;
  if (typeof result.video_share === "number") share = Math.max(0, Math.min(100, Math.round(result.video_share)));
  else if (lines.length >= 3) share = Math.round((lines.filter((l) => VIDEO.test(l)).length / lines.length) * 100);
  else if (doc.length >= 800) share = Math.min(100, Math.round((mentions / Math.max(1, doc.length / 1500)) * 10));

  const isd = result.has_isd === true || ISD.test(title) || ISD.test(lines.join(" ")) || ISD.test(doc);
  const video = result.has_video === true || titleHasVideo(title) || (share ?? 0) >= 10 || mentions >= 5;
  const priority = isd && video;
  // 영상 제작만 하는 공고: 과업·납품물이 거의 영상이고 영상 외 업무가 없음
  const nonVideoLines = lines.filter((l) => !VIDEO.test(l) && NONVIDEO.test(l)).length;
  const only = (lines.length >= 2 ? (share ?? 0) >= 80 && nonVideoLines === 0 : titleVideoOnly(title)) && !NONVIDEO.test(title);
  // 문서를 충분히 읽었고, 제목에도 영상이 없고, 영상 비중이 10% 미만일 때만 거름
  const enoughDoc = doc.length >= 800 || lines.length >= 3;
  const low = !priority && !titleHasVideo(title) && enoughDoc && share !== null && share < 10 && mentions <= 3;
  return { share, isd, video, priority, only, low: low && !only };
}
