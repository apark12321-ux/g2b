import { db } from "./supabase";
import { fetchBidByNo, filesOf } from "./g2b";

/** 첨부 목록이 비어 있는 공고의 첨부를 나라장터에서 다시 가져와 저장. 바뀐 값 반환 */
export async function refreshFiles(bid) {
  if (!bid || String(bid.key).startsWith("TEST-") || (bid.files && bid.files.length)) return null;
  const item = await fetchBidByNo(bid.bid_no, bid.bid_ord);
  if (!item) return null;
  const files = filesOf(item);
  if (!files.length) return null;
  const patch = { files };
  // 첨부 없이 분석됐던 공고는 첨부를 읽어 다시 분석하도록 비움
  if (bid.analysis && !(bid.analysis.sources || []).length) patch.analysis = null;
  const { error } = await db().from("bids").update(patch).eq("key", bid.key);
  if (error) throw error;
  return patch;
}
