const fmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const fmtTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});

export const when = (iso) => (iso ? fmt.format(new Date(iso)) : "-");
export const at = (iso) => (iso ? fmtTime.format(new Date(iso)) : "-");

export function money(n) {
  if (!n) return "가격 미공개";
  if (n >= 1e8) return `${(n / 1e8).toFixed(n % 1e8 === 0 ? 0 : 1)}억원`;
  return `${Math.round(n / 1e4).toLocaleString("ko-KR")}만원`;
}

/** 마감까지 남은 시간 → { big, small, tone } */
export function dday(iso) {
  if (!iso) return { big: "-", small: "마감 미정", tone: "" };
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return { big: "마감", small: "", tone: "closed" };
  const days = Math.floor(ms / 864e5);
  if (days === 0) return { big: `${Math.max(1, Math.ceil(ms / 36e5))}시간`, small: "오늘 마감", tone: "urgent" };
  return { big: `D-${days}`, small: "", tone: days <= 3 ? "urgent" : "" };
}
