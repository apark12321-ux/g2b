import { db } from "./supabase";
import { fetchBids, matchRule, toRow, isRevised, sameBidKey, isNewer, fetchRegions, regionBlocked, prevOrdFiles, asPrevFiles, fetchRfpFiles, mergeRfp } from "./g2b";
import { sendNtfy } from "./ntfy";
import { getSettings } from "./keywords";
import { KEYWORDS, EXCLUDE, tooClose, isExcluded } from "./watch-words";
import { analyzePending } from "./analyze";
import { refreshFiles } from "./refresh-files";
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

export async function runCollect({ hours: forceHours, quiet = false } = {}) {
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
    const firstRun = !count || quiet; // quiet: 알림 없이 채우기
    const hours = forceHours || (!count ? 72 : Number(process.env.LOOKBACK_HOURS || 6));
    // 새로 등록된 공고 + 최근 변경(정정)된 공고를 함께 조회
    const [posted, changed] = await Promise.all([
      fetchBids(hours, "1"),
      fetchBids(hours, "3").catch(() => []),
    ]);
    const seenKeys = new Set();
    const bids = [...posted, ...changed].filter((b) => {
      const k = `${b.bidNtceNo}-${b.bidNtceOrd}`;
      if (seenKeys.has(k)) return false;
      seenKeys.add(k);
      return true;
    });
    run.fetched = bids.length;

    const found = [];
    for (const b of bids) {
      const hitsByRule = rules
        .map((rule) => ({ rule, hits: matchRule(rule, b.bidNtceNm) }))
        .filter((x) => x.hits.length);
      if (hitsByRule.length) found.push({ row: toRow(b), hitsByRule });
    }
    // 같은 공고번호는 가장 최신 차수(정정공고)만 남김
    const latest = new Map();
    for (const f of found) {
      const k = sameBidKey(f.row);
      const byNo = [...latest.entries()].find(([, v]) => v.row.bid_no === f.row.bid_no);
      const key = byNo ? byNo[0] : k;
      const cur = latest.get(key);
      if (!cur || isNewer(f.row, cur.row)) latest.set(key, f);
    }
    found.length = 0;
    found.push(...latest.values());
    run.matched = found.length;

    // DB에 이미 있는 같은 공고번호의 다른 차수
    const sameNo = new Map();
    if (found.length) {
      const { data: others } = await supa
        .from("bids")
        .select("key, bid_no, bid_ord, status, files")
        .in("bid_no", found.map((f) => f.row.bid_no))
        .not("key", "like", "TEST-%");
      for (const o of others || []) {
        if (!sameNo.has(o.bid_no)) sameNo.set(o.bid_no, []);
        sameNo.get(o.bid_no).push(o);
      }
    }

    // 같은 사업의 더 최신 공고(정정·재공고)가 이미 있으면 정정 전 공고는 수집하지 않음
    if (found.length) {
      const { data: saved } = await supa
        .from("bids")
        .select("key, bid_no, bid_ord, title, org, posted_at")
        .not("key", "like", "TEST-%");
      const groups = new Map();
      for (const b of saved || []) {
        const k = sameBidKey(b);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(b);
      }
      const keep = found.filter(({ row }) => {
        const same = [...(groups.get(sameBidKey(row)) || []), ...(sameNo.get(row.bid_no) || [])];
        return !same.some((o) => o.key !== row.key && isNewer(o, row));
      });
      found.length = 0;
      found.push(...keep);
    }

    if (found.length) {
      const { data: existing, error: e2 } = await supa
        .from("bids")
        .select("key, matched_rules, keywords, notified_rule_ids, status")
        .in("key", found.map((f) => f.row.key));
      if (e2) throw e2;
      const before = new Map(existing.map((x) => [x.key, x]));

      // 정정공고에 첨부가 없으면 이전 차수 공고의 첨부를 연결
      await Promise.all(found.map(async (f) => {
        if (!f.row.files.length && Number(f.row.bid_ord) > 0) f.row.files = await prevOrdFiles(f.row.bid_no, f.row.bid_ord);
      }));

      // 제안요청서(나라장터 '제안요청정보')는 별도 API → 첨부 맨 앞에 붙임
      await Promise.all(found.map(async (f) => {
        const rfps = await fetchRfpFiles(f.row.bid_no, f.row.bid_ord);
        if (rfps.length) f.row.files = mergeRfp(f.row.files, rfps);
      }));

      // 참가가능지역 확인: 서울 외 지역으로만 제한된 공고는 숨김 처리(불참 상태로 기록, 알림 없음)
      await Promise.all(found.map(async (f) => {
        const regions = await fetchRegions(f.row.bid_no, f.row.bid_ord);
        f.row._region = regions === null ? null : regions.length ? regions.join(", ") : "전국";
        f.row._blocked = regionBlocked(regions);
      }));

      for (const { row, hitsByRule } of found) {
        const siblings = (sameNo.get(row.bid_no) || []).filter((o) => o.key !== row.key);
        // 이미 더 새 차수(정정공고)가 저장돼 있으면 예전 차수는 건너뜀
        if (siblings.some((o) => Number(o.bid_ord) > Number(row.bid_ord))) continue;
        const older = siblings.filter((o) => Number(o.bid_ord) < Number(row.bid_ord));
        // 예전 차수에 찍어 둔 검토·참여·패스 상태는 정정공고로 넘김
        const carried = older.map((o) => o.status).find((st) => st && st !== "new");
        const prev = before.get(row.key);
        const notified = new Set((prev?.notified_rule_ids || []).map(Number));
        const names = new Set(prev?.matched_rules || []);
        const words = new Set(prev?.keywords || []);
        if (row._blocked) { // 서울 외 지역 제한
          for (const { rule } of hitsByRule) notified.add(Number(rule.id));
        }

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

        if (!(row.files || []).length) {
          const prevWithFiles = older
            .filter((o) => (o.files || []).length)
            .sort((x, y) => Number(y.bid_ord) - Number(x.bid_ord))[0];
          if (prevWithFiles) row.files = asPrevFiles(prevWithFiles.files);
        }
        const { _region, _blocked, ...plain } = row;
        const record = {
          ...plain,
          ...(_region ? { region: _region } : {}),
          // 서울 외 지역 제한: 새 공고만 숨김 (검토·참여 중인 공고는 그대로)
          ...(_blocked && (!prev || prev.status === "new") ? { status: "pass" } : {}),
          matched_rules: [...names],
          keywords: [...words],
          notified_rule_ids: [...notified],
          updated_at: new Date().toISOString(),
        };
        let { error: e3 } = await supa.from("bids").upsert(record, { onConflict: "key" });
        if (e3 && /region/.test(e3.message || "")) {
          // region 칸을 아직 만들지 않은 경우: 지역 정보 없이 저장
          delete record.region;
          ({ error: e3 } = await supa.from("bids").upsert(record, { onConflict: "key" }));
        }
        if (e3 && /files/.test(e3.message || "")) {
          // files 컬럼을 아직 만들지 않은 경우: 첨부 없이 저장
          const { files, ...rest } = record;
          ({ error: e3 } = await supa.from("bids").upsert(rest, { onConflict: "key" }));
        }
        if (e3) throw e3;
        if (older.length) {
          if (carried && !before.get(row.key) && !_blocked) await supa.from("bids").update({ status: carried }).eq("key", row.key);
          await supa.from("bids").delete().in("key", older.map((o) => o.key)); // 예전 차수 삭제
        }
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

  // 정리: 이미 수집된 공고의 참가가능지역 확인 (한 번에 15건씩, 서울 외 지역 제한이면 숨김)
  try {
    const { data: unknown, error: eR } = await supa
      .from("bids")
      .select("key, bid_no, bid_ord, status")
      .is("region", null)
      .eq("status", "new")
      .not("key", "like", "TEST-%")
      .limit(15);
    if (!eR) {
      for (const b of unknown || []) {
        const regions = await fetchRegions(b.bid_no, b.bid_ord);
        if (regions === null) continue;
        const patch = { region: regions.length ? regions.join(", ") : "전국" };
        if (regionBlocked(regions)) patch.status = "pass";
        await supa.from("bids").update(patch).eq("key", b.key);
      }
    }
  } catch (e) {
    console.error("지역 확인 실패", e);
  }

  // 정리: 첨부가 없는 정정공고에 이전 공고 첨부 연결 (한 번에 10건)
  try {
    const { data: empty } = await supa
      .from("bids")
      .select("key, bid_no, bid_ord, files")
      .neq("bid_ord", "000")
      .neq("status", "pass")
      .not("key", "like", "TEST-%")
      .limit(50);
    let n = 0;
    for (const b of (empty || []).filter((x) => !(x.files || []).length)) {
      if (n++ >= 10) break;
      const files = await prevOrdFiles(b.bid_no, b.bid_ord);
      if (files.length) await supa.from("bids").update({ files }).eq("key", b.key);
    }
  } catch (e) {
    console.error("이전 공고 첨부 연결 실패", e);
  }

  // 정리: 이미 수집된 공고에 제안요청서 보충 (회차마다 10건씩, 확인한 공고는 다시 조회 안 함)
  try {
    const { data: ck } = await supa.from("app_settings").select("value").eq("key", "rfp_checked").maybeSingle();
    const checked = new Set(ck?.value ? JSON.parse(ck.value) : []);
    const { data: rows } = await supa
      .from("bids")
      .select("key, bid_no, bid_ord, files")
      .in("status", ["new", "review", "join"])
      .not("key", "like", "TEST-%")
      .order("posted_at", { ascending: false })
      .limit(300);
    const todo = (rows || []).filter((b) => !checked.has(b.key) && !(b.files || []).some((f) => f.rfp)).slice(0, 10);
    for (const b of todo) {
      const rfps = await fetchRfpFiles(b.bid_no, b.bid_ord);
      if (rfps.length) await supa.from("bids").update({ files: mergeRfp(b.files, rfps) }).eq("key", b.key);
      checked.add(b.key);
    }
    if (todo.length) {
      const live = new Set((rows || []).map((b) => b.key));
      await supa.from("app_settings").upsert({ key: "rfp_checked", value: JSON.stringify([...checked].filter((k) => live.has(k))) });
    }
  } catch (e) {
    console.error("제안요청서 보충 실패", e);
  }

  // 정리: 마감이 지난 공고 삭제 (참여로 정한 공고는 기록으로 남김)
  try {
    await supa
      .from("bids")
      .delete()
      .lt("close_at", new Date().toISOString())
      .neq("status", "join")
      .not("key", "like", "TEST-%");
  } catch (e) {
    console.error("마감 공고 정리 실패", e);
  }

  // 정리: 제외 단어에 걸리는 공고는 이미 수집된 것도 삭제 (검토·참여 중인 공고는 유지)
  try {
    const { data: rows } = await supa.from("bids").select("key, title, status").in("status", ["new", "pass"]).not("key", "like", "TEST-%");
    const drop = (rows || []).filter((b) => isExcluded(b.title)).map((b) => b.key);
    if (drop.length) await supa.from("bids").delete().in("key", drop);
  } catch (e) {
    console.error("제외 공고 정리 실패", e);
  }

  // 정리: 정정공고(최신 차수·재공고)만 남기고 정정 전 공고 삭제
  //  같은 공고번호이거나, 공고기관+공고명이 같으면 같은 사업으로 봄
  try {
    const { data: all } = await supa
      .from("bids")
      .select("key, bid_no, bid_ord, title, org, posted_at, status, files")
      .not("key", "like", "TEST-%");
    const groups = new Map(); // 대표키 → 공고 목록
    const keyOf = new Map();
    for (const b of all || []) {
      const k1 = `no:${b.bid_no}`;
      const k2 = `t:${sameBidKey(b)}`;
      const g = keyOf.get(k1) || keyOf.get(k2) || k1;
      keyOf.set(k1, g);
      keyOf.set(k2, g);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(b);
    }
    const old = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const top = list.reduce((x, y) => (isNewer(y, x) ? y : x));
      // 최신 공고에 첨부가 없으면, 지우기 전에 이전 공고의 첨부를 넘겨 둠
      if (!(top.files || []).length) {
        const src = list.filter((b) => b !== top && (b.files || []).length).sort((x, y) => (isNewer(x, y) ? -1 : 1))[0];
        if (src) {
          top.files = asPrevFiles(src.files.filter((f) => !f.prev), src.bid_ord).concat(src.files.filter((f) => f.prev));
          await supa.from("bids").update({ files: top.files }).eq("key", top.key);
        }
      }
      for (const b of list) {
        if (b === top) continue;
        // 정정 전 공고에 찍어 둔 검토·참여·불참 상태는 정정공고로 넘김
        if (b.status !== "new" && top.status === "new") {
          await supa.from("bids").update({ status: b.status }).eq("key", top.key);
          top.status = b.status;
        }
        old.push(b.key);
      }
    }
    if (old.length) await supa.from("bids").delete().in("key", old);
  } catch (e) {
    console.error("정정 전 공고 정리 실패", e);
  }

  // 수집 결과를 먼저 적어 둔다.
  // 뒤따르는 '미리 분석'은 한 건에 수십 초가 걸려 함수 제한시간(60초)을 넘길 수 있는데,
  // 기록을 마지막에 하면 그때마다 수집 이력이 통째로 사라져 '수집이 멈췄다'로 보인다.
  run.duration_ms = Date.now() - started;
  try { await supa.from("runs").insert(run); } catch (e) { console.error("수집 기록 실패", e); }

  // 남은 시간으로 새 공고 미리 분석 (첨부파일 읽기 + AI 요약). 못 끝내면 다음 수집 때 이어서 한다.
  if (!run.error) {
    try { await analyzePending(started + 35_000, 2); } catch (e) { console.error(e); }
  }
  return run;
}
