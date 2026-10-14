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

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

/** 키워드·제외어·수집할 업무구분 저장. 새로 추가된 키워드는 최근 30일 공고를 바로 찾아 채운다 */
export async function saveSettings({ include, exclude, kinds }) {
  const supa = db();
  const cur = await getSettings();
  const patch = {};
  if (Array.isArray(include)) patch.include = uniq(include).slice(0, 100);
  if (Array.isArray(exclude)) patch.exclude = uniq(exclude).slice(0, 100);
  if (Array.isArray(kinds)) patch.tags = uniq(kinds).slice(0, 4);
  const { data, error } = await supa.from("rules").update(patch).eq("id", cur.id).select().single();
  if (error) throw error;
  const added = (data.include || []).filter((w) => !(cur.include || []).some((x) => norm(x) === norm(w)));
  return { settings: data, added };
}

/** 새 키워드로 최근 30일 공고를 찾아 '신규'로 담는다 (알림 없음, 이미 있는 공고는 그대로) */
export async function backfillKeywords(words, settings, deadlineMs = Date.now() + 40000) {
  const { searchBids, KINDS, withKindTag } = await import("./g2b");
  const supa = db();
  const kinds = (settings.tags || []).length ? settings.tags : KINDS.map((k) => k.key);
  const ex = (settings.exclude || []).map(norm).filter(Boolean);
  const rows = new Map();
  for (const w of words) {
    for (const k of kinds) {
      if (Date.now() > deadlineMs) break;
      try {
        for (const r of await searchBids(w, { kind: k, days: 30 })) {
          if (ex.some((x) => norm(r.title).includes(x))) continue;
          const prev = rows.get(r.key);
          rows.set(r.key, { ...r, keywords: [...new Set([...(prev?.keywords || []), w])] });
        }
      } catch (e) { console.error("키워드 채우기 실패", w, k, e); }
    }
  }
  if (!rows.size) return 0;
  const keys = [...rows.keys()];
  const { data: have } = await supa.from("bids").select("key").in("key", keys);
  const known = new Set((have || []).map((x) => x.key));
  const fresh = [...rows.values()].filter((r) => !known.has(r.key)).map((r) => withKindTag({
    ...r, matched_rules: ["키워드"], notified_rule_ids: [settings.id], status: "new", updated_at: new Date().toISOString(),
  }));
  if (fresh.length) {
    const { error } = await supa.from("bids").upsert(fresh, { onConflict: "key" });
    if (error) throw error;
  }
  return fresh.length;
}
