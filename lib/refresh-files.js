import { db } from "./supabase";
import { fetchAllOrds, filesOf, prevOrdFiles } from "./g2b";

const ordNum = (x) => Number(String(x ?? "0").replace(/\D/g, "") || 0);

/**
 * 첨부 목록이 비어 있는 공고의 첨부를 나라장터에서 다시 가져와 저장. 바뀐 값 반환
 * 정정공고에 첨부가 없으면 같은 공고번호의 이전 차수 첨부를 연결
 */
export async function refreshFiles(bid) {
  if (!bid || String(bid.key).startsWith("TEST-") || (bid.files && bid.files.length)) return null;
  const items = await fetchAllOrds(bid.bid_no);
  if (!items.length) return null;
  const cur = items.find((x) => ordNum(x.bidNtceOrd) === ordNum(bid.bid_ord));
  let files = cur ? filesOf(cur) : [];
  if (!files.length && ordNum(bid.bid_ord) > 0) files = await prevOrdFiles(bid.bid_no, bid.bid_ord);
  if (!files.length) return null;
  const patch = { files };
  // 첨부 없이 분석됐던 공고는 첨부를 읽어 다시 분석하도록 비움
  if (bid.analysis && !(bid.analysis.sources || []).length) patch.analysis = null;
  const { error } = await db().from("bids").update(patch).eq("key", bid.key);
  if (error) throw error;
  return patch;
}
