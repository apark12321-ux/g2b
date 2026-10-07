// 웹 푸시: 설치한 앱·브라우저로 직접 알림 (ntfy와 함께 동작)
import webpush from "web-push";
import { db } from "./supabase";

let vapid = null;

/** 알림용 키: 환경변수에 있으면 사용, 없으면 처음 한 번 만들어 DB에 보관 */
export async function getVapid() {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const supa = db();
    const { data } = await supa.from("app_settings").select("key, value").in("key", ["vapid_public", "vapid_private"]);
    const m = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    if (m.vapid_public && m.vapid_private) {
      vapid = { publicKey: m.vapid_public, privateKey: m.vapid_private };
    } else {
      const k = webpush.generateVAPIDKeys();
      const { error } = await supa.from("app_settings").upsert([
        { key: "vapid_public", value: k.publicKey },
        { key: "vapid_private", value: k.privateKey },
      ]);
      if (error) throw new Error("app_settings 표가 없습니다. 안내된 SQL을 먼저 실행하세요.");
      vapid = k;
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@whomedia.co.kr", vapid.publicKey, vapid.privateKey);
  return vapid;
}

/** 구독한 모든 기기로 알림. 끊긴 구독은 정리 */
export async function pushAll(payload, only) {
  await getVapid();
  const supa = db();
  let q = supa.from("push_subs").select("endpoint, sub");
  if (only) q = q.eq("endpoint", only);
  const { data, error } = await q;
  if (error) throw error;
  let sent = 0;
  for (const row of data || []) {
    try {
      await webpush.sendNotification(row.sub, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await supa.from("push_subs").delete().eq("endpoint", row.endpoint);
      else console.error("웹 푸시 실패", e.statusCode, e.body);
    }
  }
  return sent;
}
