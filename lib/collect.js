import { db } from "./supabase";
import { withKindTag, kindOfBid, fetchBids, matchRule, toRow, isRevised, sameBidKey, isNewer, fetchRegions, prevOrdFiles, asPrevFiles, fetchRfpFiles, mergeRfp, KINDS } from "./g2b";
import { sendNtfy } from "./ntfy";
import { getSettings } from "./keywords";
import { analyzePending } from "./analyze";
import { refreshFiles } from "./refresh-files";
import { notifyBid } from "./notify";
import { FRESH_START } from "./fresh";

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

export async function runCollect({ hours: forceHours, quiet = false, analyze = true } = {}) {
  const supa = db();
  const started = Date.now();
  const run = { fetched: 0, matched: 0, sent: 0, failed: 0, error: null };
  let backfilled = 0; // 첫 수집 때 알림 없이 모아 온 공고 수
  let held = 0; // 분석 후 알릴 공고 수

  try {
    const settings = await getSettings(); // 알림 채널(topic) 보관용
    // 사용자가 화면에서 등록한 키워드·제외어로만 수집한다 (고정 목록 없음)
    const rules = [{ id: settings.id, name: "키워드", topic: settings.topic, include: settings.include || [], exclude: settings.exclude || [], tags: [] }];
    // 수집할 업무구분 (용역·물품·공사·외자). 저장된 값이 없으면 넷 다
    const kinds = (settings.tags || []).filter((t) => KINDS.some((k) => k.key === t));
    const useKinds = kinds.length ? kinds : KINDS.map((k) => k.key);

    // 처음 실행이면 최근 3일 공고를 채워 넣고(요약 알림 1건), 이후에는 최근 몇 시간만 확인
    const { count } = await supa
      .from("bids")
      .select("key", { count: "exact", head: true })
      .gte("updated_at", FRESH_START)
      .not("key", "like", "TEST-%"); // 테스트 공고는 세지 않음
    const firstRun = !count || quiet; // quiet: 알림 없이 채우기
    const hours = forceHours || (!count ? 72 : Number(process.env.LOOKBACK_HOURS || 6));
    // 키워드가 하나도 없으면 나라장터를 조회하지 않는다 (등록하는 순간부터 모음)
    const lists = rules[0].include.length
      ? await Promise.allSettled(useKinds.flatMap((k) => [
          fetchBids(hours, "1", k),
          fetchBids(hours, "3", k).catch(() => []),
        ]))
      : [];
    const ok = lists.filter((x) => x.status === "fulfilled");
    if (lists.length && !ok.length) throw lists[0].reason;
    const seenKeys = new Set();
    const bids = ok.flatMap((x) => x.value).filter((b) => {
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
        .gte("updated_at", FRESH_START)
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
        .gte("updated_at", FRESH_START)
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
        .gte("updated_at", FRESH_START)
        .in("key", found.map((f) => f.row.key));
      if (e2) throw e2;
      const before = new Map(existing.map((x) => [x.key, x]));
      // 예전(초기화 이전) 데이터로 남아 있는 같은 공고 → 새 공고처럼 비우고 담는다
      const { data: oldRows } = await supa.from("bids").select("key").in("key", found.map((f) => f.row.key)).lt("updated_at", FRESH_START);
      const oldKeys = new Set((oldRows || []).map((x) => x.key));

      // 정정공고에 첨부가 없으면 이전 차수 공고의 첨부를 연결
      await Promise.all(found.map(async (f) => {
        if (!f.row.files.length && Number(f.row.bid_ord) > 0) f.row.files = await prevOrdFiles(f.row.bid_no, f.row.bid_ord, f.row.kind);
      }));

      // 제안요청서(나라장터 '제안요청정보')는 별도 API → 첨부 맨 앞에 붙임
      await Promise.all(found.map(async (f) => {
        const rfps = await fetchRfpFiles(f.row.bid_no, f.row.bid_ord);
        if (rfps.length) f.row.files = mergeRfp(f.row.files, rfps);
      }));

      // 참가가능지역 기록 (보여 주기만 하고 거르지는 않음)
      await Promise.all(found.map(async (f) => {
        const regions = await fetchRegions(f.row.bid_no, f.row.bid_ord);
        f.row._region = regions === null ? null : regions.length ? regions.join(", ") : "전국";
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

        for (const { rule, hits } of hitsByRule) {
          names.add(rule.name);
          hits.forEach((h) => words.add(h));
          if (notified.has(Number(rule.id))) continue;
          if (firstRun) { notified.add(Number(rule.id)); backfilled++; continue; }
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
        const { _region, ...plain } = row;
        const record = {
          ...plain,
          ...(_region ? { region: _region } : {}),
          matched_rules: [...names],
          keywords: [...words],
          notified_rule_ids: [...notified],
          updated_at: new Date().toISOString(),
          ...(oldKeys.has(row.key) ? { status: "new", analysis: null, analyzed_at: null, memo: null } : {}),
        };
        let { error: e3 } = await supa.from("bids").upsert(withKindTag(record), { onConflict: "key" });
        if (e3 && /region/.test(e3.message || "")) {
          // region 칸을 아직 만들지 않은 경우: 지역 정보 없이 저장
          delete record.region;
          ({ error: e3 } = await supa.from("bids").upsert(withKindTag(record), { onConflict: "key" }));
        }
        if (e3 && /files/.test(e3.message || "")) {
          // files 컬럼을 아직 만들지 않은 경우: 첨부 없이 저장
          const { files, ...rest } = record;
          ({ error: e3 } = await supa.from("bids").upsert(withKindTag(rest), { onConflict: "key" }));
        }
        if (e3) throw e3;
        if (older.length) {
          if (carried && !before.get(row.key)) await supa.from("bids").update({ status: carried }).eq("key", row.key);
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
        title: `키워드에 맞는 입찰공고 ${backfilled}건을 모았습니다`,
        message: "최근 3일 동안 올라온 관련 공고입니다. 앞으로 새 공고가 올라오면 한 건씩 바로 알려 드립니다.",
        url: process.env.SITE_URL || "https://www.g2b.go.kr",
      });
      run.sent++;
    } catch (e) {
      run.failed++;
    }
  }

  // 정리: 이미 수집된 공고의 참가가능지역 기록 (한 번에 15건씩)
  try {
    const { data: unknown, error: eR } = await supa
      .from("bids")
      .select("key, bid_no, bid_ord, status")
      .gte("updated_at", FRESH_START)
      .is("region", null)
      .eq("status", "new")
      .not("key", "like", "TEST-%")
      .limit(15);
    if (!eR) {
      for (const b of unknown || []) {
        const regions = await fetchRegions(b.bid_no, b.bid_ord);
        if (regions === null) continue;
        const patch = { region: regions.length ? regions.join(", ") : "전국" };
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
      .select("key, bid_no, bid_ord, files, matched_rules")
      .gte("updated_at", FRESH_START)
      .neq("bid_ord", "000")
      .neq("status", "pass")
      .not("key", "like", "TEST-%")
      .limit(50);
    let n = 0;
    for (const b of (empty || []).filter((x) => !(x.files || []).length)) {
      if (n++ >= 10) break;
      const files = await prevOrdFiles(b.bid_no, b.bid_ord, kindOfBid(b));
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
      .gte("updated_at", FRESH_START)
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

  // 정리: 정정공고(최신 차수·재공고)만 남기고 정정 전 공고 삭제
  //  같은 공고번호이거나, 공고기관+공고명이 같으면 같은 사업으로 봄
  try {
    const { data: all } = await supa
      .from("bids")
      .select("key, bid_no, bid_ord, title, org, posted_at, status, files")
      .gte("updated_at", FRESH_START)
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

  // 미리 분석은 한 건에 수십 초가 걸려 함수 제한시간(60초)을 넘긴다.
  // 호출한 쪽이 504를 받으면 수집이 된 건지 아닌지 알 수 없으므로, 기본적으로 여기서 하지 않고
  // /api/analyze-pending 으로 따로 떼어 둔다 (analyze: true 로 부르면 예전처럼 이어서 한다).
  if (analyze && !run.error) {
    try { await analyzePending(started + 35_000, 2); } catch (e) { console.error(e); }
  }
  return run;
}
