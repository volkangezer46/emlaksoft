import type { SupabaseClient } from "@supabase/supabase-js";
import { BADGE_BY_CODE, evaluateBadges } from "@/lib/gamification";
import { LEAGUE_ROLES, loadLeagueActivity, loadLeagueData, loadLeagueSettings, periodOf } from "@/lib/gamification-query";
import { getSampleScope, sampleValues } from "@/lib/sample-scope";
import { notifyTenant } from "@/lib/notify";
import { trDayKey } from "@/lib/clock";
import {
  buildChallengeResult,
  challengeCounts,
  challengeFinishMessage,
  challengeProgress,
  isScoreRuleKey,
  type ChallengeDef,
} from "@/lib/league/challenge";

/**
 * Günlük lig işi (gunluk-ozet cron'una bağlı; yeni cron yok):
 *  1. Süresi dolan meydan okumaları mühürler (sonuç + ofis geneli kutlama bildirimi, bildirim TEK KEZ: dedupe).
 *  2. Yeni kazanılan rozetleri yazar ve ofis geneline duyurur (aylık kapanışta kesinleşen sıralama rozetleri hariç).
 *
 * Bildirim metinlerinde TUTAR YOK (P12): yalnız ad, puan ve adet.
 */

/** Sıralama anlık değiştiği için ay içinde mühürlenmeyen rozetler (ay kapanışında `lig-snapshot` yazar). */
const RANK_BADGES = new Set(["ayin_sampiyonu", "podyum"]);
const MAX_BADGE_ANNOUNCEMENTS = 5;

type Row = Record<string, unknown>;

export type LeagueDailyResult = { finishedChallenges: number; badgesWritten: number; announced: number; failed: number };

function toDef(r: Row): ChallengeDef | null {
  const metric = String(r.metric ?? "");
  if (!isScoreRuleKey(metric)) return null;
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    description: (r.description as string | null) ?? null,
    rewardText: (r.reward_text as string | null) ?? null,
    metric,
    scope: r.scope === "individual" ? "individual" : "team",
    targetValue: Number(r.target_value) || 1,
    startsAtIso: String(r.starts_at),
    endsAtIso: String(r.ends_at),
    status: r.status === "finished" ? "finished" : r.status === "cancelled" ? "cancelled" : "active",
  };
}

export async function runLeagueDailyForTenant(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
): Promise<LeagueDailyResult> {
  const out: LeagueDailyResult = { finishedChallenges: 0, badgesWritten: 0, announced: 0, failed: 0 };
  const nowIso = new Date(nowMs).toISOString();

  // ── 1) Biten meydan okumalar ─────────────────────────────────────────
  const { data: due } = await admin
    .from("league_challenges")
    .select("id, title, description, reward_text, metric, scope, target_value, starts_at, ends_at, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .lte("ends_at", nowIso)
    .order("ends_at", { ascending: true })
    .limit(20);
  if (due && due.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, role")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("role", [...LEAGUE_ROLES])
      .limit(500);
    const names = new Map((profiles ?? []).map((p) => [String(p.id), String(p.full_name ?? "Danışman")]));
    const agentIds = new Set(names.keys());
    const scope = await getSampleScope(admin, tenantId);
    for (const row of due) {
      const def = toDef(row as Row);
      if (!def) continue;
      try {
        const activity = await loadLeagueActivity(admin, {
          tenantId,
          startIso: def.startsAtIso,
          endIso: def.endsAtIso,
          agentIds,
          sampleVals: sampleValues(scope.include),
          nowMs,
        });
        const progress = challengeProgress(def, challengeCounts(def, activity, { includeSample: scope.include }));
        const result = buildChallengeResult(def, progress);
        const { error } = await admin
          .from("league_challenges")
          .update({ status: "finished", result, finished_at: nowIso })
          .eq("id", def.id)
          .eq("tenant_id", tenantId)
          .eq("status", "active");
        if (error) {
          out.failed += 1;
          continue;
        }
        out.finishedChallenges += 1;
        const msg = challengeFinishMessage(def, result, (id) => names.get(id) ?? "Danışman");
        await notifyTenant({
          tenantId,
          title: msg.title,
          body: msg.body,
          href: "/app/lig?sekme=meydan",
          kind: result.reached ? "success" : "info",
          dedupeKey: `challenge-finish:${def.id}`,
        });
      } catch (e) {
        out.failed += 1;
        console.error("league-daily challenge", tenantId, def.id, e);
      }
    }
  }

  // ── 2) Yeni rozetler ─────────────────────────────────────────────────
  try {
    const today = trDayKey(nowMs);
    const period = periodOf(new Date(nowMs));
    const settings = await loadLeagueSettings(admin, tenantId);
    const league = await loadLeagueData(admin, { period, tenantId, todayIso: today, nowMs, settings });
    const candidates: Array<{ staffId: string; code: string; period: string | null }> = [];
    for (const r of league.ranked) {
      const stats = league.statsById.get(r.staffId);
      if (!stats) continue;
      for (const code of evaluateBadges(stats, { scope: "monthly" })) {
        if (!RANK_BADGES.has(code)) candidates.push({ staffId: r.staffId, code, period });
      }
      for (const code of evaluateBadges(stats, { scope: "lifetime" })) {
        candidates.push({ staffId: r.staffId, code, period: null });
      }
    }
    if (candidates.length > 0) {
      const { data: existingRows } = await admin
        .from("agent_badges")
        .select("staff_id, badge_code, period")
        .eq("tenant_id", tenantId)
        .or(`period.eq.${period},period.is.null`)
        .limit(5000);
      const key = (s: unknown, c: unknown, p: unknown) => `${s}|${c}|${p ?? ""}`;
      const have = new Set((existingRows ?? []).map((m) => key(m.staff_id, m.badge_code, m.period)));
      // İlk çalışma (hiç rozet yok): geçmiş birikimi sessizce yaz; ofise rozet yağmuru yağdırma.
      const firstRun = (existingRows ?? []).length === 0;
      const fresh = candidates.filter((c) => !have.has(key(c.staffId, c.code, c.period)));
      if (fresh.length > 0) {
        const { error } = await admin.from("agent_badges").insert(
          fresh.map((c) => ({
            tenant_id: tenantId,
            staff_id: c.staffId,
            badge_code: c.code,
            period: c.period,
            meta: { source: "league-daily", at: nowIso },
          })),
        );
        if (error) {
          out.failed += 1;
        } else {
          out.badgesWritten += fresh.length;
          if (!firstRun) {
            const nameOf = (id: string) => league.agents.find((a) => a.id === id)?.fullName ?? "Danışman";
            for (const c of fresh.slice(0, MAX_BADGE_ANNOUNCEMENTS)) {
              const def = BADGE_BY_CODE.get(c.code);
              if (!def) continue;
              await notifyTenant({
                tenantId,
                title: `${nameOf(c.staffId)} yeni rozet kazandı: ${def.name}`,
                body: def.description,
                href: "/app/lig",
                kind: "success",
                dedupeKey: `badge:${c.staffId}:${c.code}:${c.period ?? "omur"}`,
              });
              out.announced += 1;
            }
          }
        }
      }
    }
  } catch (e) {
    out.failed += 1;
    console.error("league-daily badges", tenantId, e);
  }

  return out;
}
