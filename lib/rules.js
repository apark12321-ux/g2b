const list = (v) =>
  (Array.isArray(v) ? v : String(v || "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 50);

/** 사이트에서 받은 규칙 값을 정리. 오류면 문자열을 던짐 */
export function cleanRule(input, partial = false) {
  const out = {};
  if (!partial || input.name !== undefined) {
    out.name = String(input.name || "").trim();
    if (!out.name) throw "규칙 이름을 입력하세요.";
  }
  if (!partial || input.topic !== undefined) {
    out.topic = String(input.topic || "").trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(out.topic))
      throw "알림 채널 이름은 영문·숫자·-·_ 로 8~64자여야 합니다.";
  }
  if (!partial || input.include !== undefined) {
    out.include = list(input.include);
    if (!out.include.length) throw "포함 키워드를 하나 이상 입력하세요.";
  }
  if (!partial || input.exclude !== undefined) out.exclude = list(input.exclude);
  if (input.active !== undefined) out.active = !!input.active;
  return out;
}
