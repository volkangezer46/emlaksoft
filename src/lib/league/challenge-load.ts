import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLeagueActivity } from "@/lib/gamification-query";
import { sampleValues } from "@/lib/sample-scope";
import {
  challengeCounts,
  challengeProgress,
  challengeState,
  isScoreRuleKey,
  type ChallengeDef,
  type ChallengeProgress,
  type ChallengeResult,
  type ChallengeState,
} from "@/lib/league/challenge";

export type ChallengeCard = {
  def: ChallengeDef;
  /** upcoming/live/ended: zaman durumu · finished/cancelled: kayıt durumu */
  state: ChallengeState | "finished" | "cancelled";
  progress: ChallengeProgress;
};

type Row = Record<string, unknown>;

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

/** Mühürlü sonuçtan ilerleme görünümü (bitmiş meydan okuma yeniden hesaplanmaz). */
function progressFromResult(def: ChallengeDef, result: Partial<ChallengeResult> | null): ChallengeProgress {
  const target = Math.max(1, def.targetValue);
  const current = Number(result?.current) || 0;
  return {
    current,
    target,
    pct: Math.max(0, Math.min(100, Math.round((current / target) * 100))),
    reached: result?.reached === true,
    entries: Array.isArray(result?.entries) ? result!.entries! : [],
    winners: Array.isArray(result?.winners) ? result!.winners! : [],
  };
}

/**
 * Meydan okuma panosu: son 20 kayıt (iptaller dahil değil). Süren/bekleyen olanların ilerlemesi CANLI kayıtlardan
 * hesaplanır (aynı lig aktivite satırları); bitenler mühürlü sonuçtan okunur. Tablo yoksa boş liste.
 */
export async function loadChallengeBoard(
  client: SupabaseClient,
  opts: {
    tenantId: string;
    /** Küme ya da (lig profil okuması bitince çözülen) söz: bu sorgular lig verisiyle PARALEL başlar */
    agentIds: ReadonlySet<string> | Promise<ReadonlySet<string>>;
    includeSample: boolean | Promise<boolean>;
    nowMs: number;
  },
): Promise<ChallengeCard[]> {
  let rows: Row[] = [];
  try {
    const { data, error } = await client
      .from("league_challenges")
      .select("id, title, description, reward_text, metric, scope, target_value, starts_at, ends_at, status, result")
      .eq("tenant_id", opts.tenantId)
      .neq("status", "cancelled")
      .order("ends_at", { ascending: false })
      .limit(20);
    if (error || !data) return [];
    rows = data as Row[];
  } catch {
    return [];
  }

  const includeSample = await opts.includeSample;
  const defs = rows.map((r) => ({ row: r, def: toDef(r) })).filter((x): x is { row: Row; def: ChallengeDef } => x.def !== null);
  const live = defs.filter((x) => x.def.status === "active");
  let activity: Awaited<ReturnType<typeof loadLeagueActivity>> = [];
  if (live.length > 0) {
    const starts = live.map((x) => Date.parse(x.def.startsAtIso));
    const ends = live.map((x) => Date.parse(x.def.endsAtIso));
    activity = await loadLeagueActivity(client, {
      tenantId: opts.tenantId,
      startIso: new Date(Math.min(...starts)).toISOString(),
      endIso: new Date(Math.max(...ends)).toISOString(),
      agentIds: opts.agentIds,
      sampleVals: sampleValues(includeSample),
      nowMs: opts.nowMs,
    });
  }

  return defs.map(({ row, def }) => {
    if (def.status === "finished") {
      return { def, state: "finished" as const, progress: progressFromResult(def, row.result as Partial<ChallengeResult> | null) };
    }
    const counts = challengeCounts(def, activity, { includeSample });
    return { def, state: challengeState(def, opts.nowMs), progress: challengeProgress(def, counts) };
  });
}
