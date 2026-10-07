import { db } from "./supabase";
import { fetchBids, matchRule, toRow, isRevised } from "./g2b";
import { sendNtfy } from "./ntfy";
import { getSettings } from "./keywords";
import { KEYWORDS, EXCLUDE, tooClose } from "./watch-words";
import { analyzePending } from "./analyze";
import { notifyBid } from "./notify";
import { titleHasVideo } from "./video-score";

const won = (n) => (n ? `${n.toLocaleString("ko-KR")}원` : "미공개");
const kst = (iso) =>
  iso
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit",
        weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso))
    : "-";

function message(row, hits) {
  const org = row.org || "-";
  const demand = row.demand_org && row.demand_org !== org ? ` (수요: ${row.demand_org})` : "";
  return [
    `발주: ${org}${demand}`,
    `추정가격: ${won(row.price)}`,
    `입찰마감: ${kst(row.close_at)}`,
    `공고번호: ${row.key}`,
    `키워드: ${hits.join(", ")}`,
  ].join("\n");
}

export async function runCollect() {
  const supa = db();
  const started = Date.now();
  const run = { fetched: 0, matched: 0, sent: 0, failed: 0, error: null };
  let backfilled = 0; // 첫 수집 때 알림 없이 모아 온 공고 수
  let held = 0; // 분석 후 알릴 공고 수

  try {
    const settings = await getSettings(); // 알림 채널(topic) 보관용
    const rules = [{ id: settings.id, name: "키워드", topic: settings.topic, include: KEYWORDS, exclude: EXCLUDE, tags: [] }];

    // 처음 실행이면 최근 3일 공고를 채워 넣고(요약 알림 1건), 이후에는 최근 몇 시간만 확인
    const { count } = await supa
      .from("bids")
      .select("key", { count: "exact", head: true })
      .not("key", "like", "TEST-%"); // 테스트 공고는 세지 않음
    const firstRun = !count;
    const bids = await fetchBids(firstRun ? 72 : Number(process.env.LOOKBACK_HOURS || 6));
    run.fetched = bids.length;

    const found = [];
    for (const b of bids) {
      const hitsByRule = rules
        .map((rule) => ({ rule, hits: matchRule(rule, b.bidNtceNm) }))
        .filter((x) => x.hits.length);
      if (hitsByRule.length) found.push({ row: toRow(b), hitsByRule });
    }
    run.matched = found.length;

    if (found.length) {
      const { data: existing, error: e2 } = await supa
        .from("bids")
        .select("key, matched_rules, keywords, notified_rule_ids")
        .in("key", found.map((f) => f.row.key));
      if (e2) throw e2;
      const before = new Map(existing.map((x) => [x.key, x]));

      for (const { row, hitsByRule } of found) {
        const prev = before.get(row.key);
        const notified = new Set((prev?.notified_rule_ids || []).map(Number));
        const names = new Set(prev?.matched_rules || []);
        const words = new Set(prev?.keywords || []);

        for (const { rule, hits } of hitsByRule) {
          names.add(rule.name);
          hits.forEach((h) => words.add(h));
          if (notified.has(Number(rule.id))) continue;
          if (firstRun) { notified.add(Number(rule.id)); backfilled++; continue; }
          // 마감 5일 이내 공고는 알리지 않음 (나중에도 알리지 않도록 처리 완료로 표시)
          if (tooClose(row.close_at)) { notified.add(Number(rule.id)); continue; }
          // 공고명만으로 영상 업무가 분명하지 않으면, 첨부 분석으로 영상 비중을 확인한 뒤 알림
          if (!titleHasVideo(row.title)) { held++; continue; }
          try {
            await notifyBid(row, rule.topic, { hits });
            notified.add(Number(rule.id));
            run.sent++;
          } catch (err) {
            run.failed++; // 기록하지 않음 → 다음 수집 때 재시도
            console.error("알림 실패", rule.name, row.key, err);
          }
        }

        const record = {
          ...row,
          matched_rules: [...names],
          keywords: [...words],
          notified_rule_ids: [...notified],
          updated_at: new Date().toISOString(),
        };
        let { error: e3 } = await supa.from("bids").upsert(record, { onConflict: "key" });
        if (e3 && /files/.test(e3.message || "")) {
          // files 컬럼을 아직 만들지 않은 경우: 첨부 없이 저장
          const { files, ...rest } = record;
          ({ error: e3 } = await supa.from("bids").upsert(rest, { onConflict: "key" }));
        }
        if (e3) throw e3;
      }
    }
  } catch (err) {
    run.error = String(err?.message || err);
  }

  // 첫 수집이면 모아 온 공고 수를 알림 1건으로 알려 줌
  if (!run.error && backfilled > 0) {
    try {
      const s = await getSettings();
      await sendNtfy({
        topic: s.topic,
        title: `관련 입찰공고 ${backfilled}건을 모았습니다`,
        message: "최근 3일 동안 올라온 관련 공고입니다. 앞으로 새 공고가 올라오면 한 건씩 바로 알려 드립니다.",
        url: process.env.SITE_URL || "https://www.g2b.go.kr",
      });
      run.sent++;
    } catch (e) {
      run.failed++;
    }
  }

  // 남은 시간으로 새 공고 미리 분석 (첨부파일 읽기 + AI 요약)
  if (!run.error) {
    try { await analyzePending(started + 40_000); } catch (e) { console.error(e); }
  }

  run.duration_ms = Date.now() - started;
  await supa.from("runs").insert(run);
  return run;
}
