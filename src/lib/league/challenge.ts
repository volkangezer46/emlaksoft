/**
 * Meydan okuma (challenge) — SAF ilerleme ve sonuç hesabı.
 *
 * İlerleme ASLA saklanmaz: mevcut kayıtlardan (aynı lig aktivite satırları) her seferinde hesaplanır; böylece silinen/geri
 * alınan kayıt ilerlemeyi düşürür, sahte sayı oluşamaz. Yalnız BİTİŞTE `result` mühürlenir (tutar içermez, P12).
 *
 * Ölçüt (`metric`) = lig puan kuralı anahtarı; sayılan şey PUAN değil ADETtir (kural puanı 0'a çekilmiş olsa bile
 * meydan okuma adet sayar).
 */
import { SCORE_RULE_KEYS, computeAgentScores, type ActivityRow, type ScoreRuleKey, type ScoreRuleset } from "@/lib/gamification";

export type ChallengeScope = "team" | "individual";
export type ChallengeStatus = "active" | "finished" | "cancelled";

export type ChallengeDef = {
  id: string;
  title: string;
  description: string | null;
  rewardText: string | null;
  metric: ScoreRuleKey;
  scope: ChallengeScope;
  targetValue: number;
  startsAtIso: string;
  endsAtIso: string;
  status: ChallengeStatus;
};

export type ChallengeState = "upcoming" | "live" | "ended";

export function isScoreRuleKey(value: string): value is ScoreRuleKey {
  return (SCORE_RULE_KEYS as readonly string[]).includes(value);
}

/** Zaman durumu: başlamadı / sürüyor / süresi doldu. İptal edilmiş kayıt çağıranda ayrıca ele alınır. */
export function challengeState(c: Pick<ChallengeDef, "startsAtIso" | "endsAtIso">, nowMs: number): ChallengeState {
  const start = Date.parse(c.startsAtIso);
  const end = Date.parse(c.endsAtIso);
  if (nowMs < start) return "upcoming";
  if (nowMs >= end) return "ended";
  return "live";
}

/** Kalan süre (ms); bitmişse 0. */
export function challengeRemainingMs(c: Pick<ChallengeDef, "endsAtIso">, nowMs: number): number {
  return Math.max(0, Date.parse(c.endsAtIso) - nowMs);
}

export function remainingLabel(ms: number): string {
  if (ms <= 0) return "süre doldu";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} gün kaldı`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} saat kaldı`;
  return `${Math.max(1, Math.floor(ms / 60_000))} dk kaldı`;
}

export type ChallengeEntry = { staffId: string; count: number; rank: number };

export type ChallengeProgress = {
  /** Ekip: tüm katılımcıların toplamı · Bireysel: lider katılımcının adedi */
  current: number;
  target: number;
  /** 0-100 (hedefi aşsa da 100'de durur) */
  pct: number;
  reached: boolean;
  /** Adedi > 0 olan katılımcılar, sıralı (eşit adet aynı sıra) */
  entries: ChallengeEntry[];
  /** Bireysel: hedefe ulaşanlar · Ekip: hedef tutmuşsa katkı veren herkes */
  winners: ChallengeEntry[];
};

/**
 * Meydan okumanın SAYDIĞI adetler: [başlangıç, bitiş) aralığındaki, ölçüte uyan, örnek olmayan, tekilleştirilmiş
 * satırlar. Kural puanı 0 olsa da sayılır (tüm kurallar 1 puanlı sayılır).
 */
export function challengeCounts(
  c: Pick<ChallengeDef, "metric" | "startsAtIso" | "endsAtIso">,
  activity: readonly ActivityRow[],
  opts: { includeSample?: boolean } = {},
): Map<string, number> {
  const start = Date.parse(c.startsAtIso);
  const end = Date.parse(c.endsAtIso);
  const rows = activity.filter((r) => {
    if (r.kind !== c.metric) return false;
    const t = Date.parse(r.at);
    return !Number.isNaN(t) && t >= start && t < end;
  });
  const ones = Object.fromEntries(SCORE_RULE_KEYS.map((k) => [k, 1])) as ScoreRuleset;
  const out = new Map<string, number>();
  for (const s of computeAgentScores(rows, ones, opts)) {
    const n = s.breakdown[c.metric].count;
    if (n > 0) out.set(s.staffId, n);
  }
  return out;
}

export function challengeProgress(
  c: Pick<ChallengeDef, "scope" | "targetValue">,
  counts: ReadonlyMap<string, number>,
): ChallengeProgress {
  const target = Math.max(1, Math.floor(c.targetValue));
  const sorted = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])));
  const entries: ChallengeEntry[] = [];
  let lastN: number | null = null;
  let lastRank = 0;
  sorted.forEach(([staffId, count], i) => {
    const rank = lastN !== null && count === lastN ? lastRank : i + 1;
    lastN = count;
    lastRank = rank;
    entries.push({ staffId, count, rank });
  });

  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const current = c.scope === "team" ? total : (entries[0]?.count ?? 0);
  const reached = current >= target;
  const winners = c.scope === "team" ? (reached ? entries : []) : entries.filter((e) => e.count >= target);
  return {
    current,
    target,
    pct: Math.max(0, Math.min(100, Math.round((current / target) * 100))),
    reached,
    entries,
    winners,
  };
}

export type ChallengeResult = {
  reached: boolean;
  current: number;
  target: number;
  scope: ChallengeScope;
  /** İlk 10 katılımcı; yalnız kimlik + adet (TUTAR YOK) */
  entries: ChallengeEntry[];
  winners: ChallengeEntry[];
};

/** Bitişte `league_challenges.result` olarak mühürlenen özet. */
export function buildChallengeResult(c: Pick<ChallengeDef, "scope">, progress: ChallengeProgress): ChallengeResult {
  return {
    reached: progress.reached,
    current: progress.current,
    target: progress.target,
    scope: c.scope,
    entries: progress.entries.slice(0, 10),
    winners: progress.winners.slice(0, 10),
  };
}

/** Kutlama bildirimi metni (başlık + gövde); adlar çağıranda çözülür. */
export function challengeFinishMessage(
  c: Pick<ChallengeDef, "title" | "rewardText" | "scope">,
  result: ChallengeResult,
  nameOf: (staffId: string) => string,
): { title: string; body: string } {
  if (!result.reached) {
    return {
      title: `Meydan okuma bitti: ${c.title}`,
      body: `Hedefe ulaşılamadı (${result.current}/${result.target}). Bir sonrakinde birlikte yakalayacağız.`,
    };
  }
  const prize = c.rewardText ? ` Ödül: ${c.rewardText}.` : "";
  if (c.scope === "team") {
    return {
      title: `Meydan okuma tamamlandı: ${c.title}`,
      body: `Ekip hedefi aştı (${result.current}/${result.target}).${prize}`,
    };
  }
  const names = result.winners.slice(0, 3).map((w) => `${nameOf(w.staffId)} (${w.count})`).join(", ");
  return {
    title: `Meydan okuma kazananı: ${c.title}`,
    body: `Hedefe ulaşanlar: ${names}.${prize}`,
  };
}
