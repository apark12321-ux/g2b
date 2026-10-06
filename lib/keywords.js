import { db } from "./supabase";

export const randomTopic = () =>
  "bid-" + Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);

const uniq = (arr) => [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];

/**
 * 키워드 설정 1건을 돌려준다.
 * - 규칙이 없으면 새로 만들고
 * - 여러 개면 키워드를 하나로 합친 뒤 나머지는 지우고
 * - 예시 채널 이름(change-me)이면 새 이름으로 바꾼다
 */
export async function getSettings() {
  const supa = db();
  const { data: rules, error } = await supa.from("rules").select("*").order("id");
  if (error) throw error;

  if (!rules.length) {
    const { data, error: e } = await supa
      .from("rules")
      .insert({ name: "키워드 알림", topic: randomTopic(), include: [], exclude: [], active: true })
      .select()
      .single();
    if (e) throw e;
    return data;
  }

  const [main, ...rest] = rules;
  const patch = {};
  if (rest.length) {
    patch.include = uniq(rules.flatMap((r) => r.include));
    patch.exclude = uniq(rules.flatMap((r) => r.exclude));
  }
  if (main.name !== "키워드 알림") patch.name = "키워드 알림";
  if (!main.topic || main.topic.includes("change-me")) patch.topic = randomTopic();

  if (!Object.keys(patch).length) return main;
  const { data, error: e2 } = await supa.from("rules").update(patch).eq("id", main.id).select().single();
  if (e2) throw e2;
  if (rest.length) await supa.from("rules").delete().in("id", rest.map((r) => r.id));
  return data;
}
