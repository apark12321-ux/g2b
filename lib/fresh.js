// 새로 시작한 시점. 이 시각 이전에 마지막으로 갱신된 공고(예전 사내용 데이터)는
// 지우지 않고 보관만 하며, 화면·수집·분석 어디에서도 쓰지 않는다.
// 되돌리려면 이 값을 예전 날짜로 바꾸면 된다.
export const FRESH_START = "2026-10-15T12:46:30.000Z"; // 2026-10-15 21:46 (한국 시간)
export const isOld = (b) => !b?.updated_at || new Date(b.updated_at) < new Date(FRESH_START);
// 예전 공고를 새로 담을 때 비울 칸
export const RESET_FIELDS = { status: "new", analysis: null, analyzed_at: null, memo: "" };
