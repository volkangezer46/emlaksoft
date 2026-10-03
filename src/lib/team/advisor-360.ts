/**
 * Danışman 360 (ekip/[id]) ve Kıyas "dikkat" mantığı — SAF hesap, uydurma metrik yok.
 * Girdiler gerçek tablo satırlarıdır; veri yoksa değer null/boş döner.
 */
import { trMonthContext } from "@/lib/team/scorecard";

/** Talep durumu: talepler listesindeki "açık" kümesiyle aynı. */
export const OPEN_DEMAND_STATUSES = ["new", "active", "matched"] as const;

/** Kıyas: bir danışman bu eşiklerden birini aşarsa "dikkat gerektiren" sayılır. */
export const ATTENTION_OVERDUE_TASKS = 3;
export const ATTENTION_UNTRACKED_DEMANDS = 3;

const DAY = 86_400_000;

/** İçinde bulunulan ay ve önceki ayın [başlangıç, bitiş) sınırları (TR takvimi, ISO). */
export function monthRanges(nowMs: number): { prevStartIso: string; thisStartIso: string; nextStartIso: string } {
  const cur = trMonthContext(nowMs);
  const thisStart = Date.parse(cur.monthStartIso);
  const prev = trMonthContext(thisStart - 1);
  // Ay başından +32 gün her ay sonraki ayın 2-5. gününe düşer (ay 28-31 gün).
  const nextStart = Date.parse(trMonthContext(thisStart + 32 * DAY).monthStartIso);
  return { prevStartIso: prev.monthStartIso, thisStartIso: cur.monthStartIso, nextStartIso: new Date(nextStart).toISOString() };
}

export type Delta = { diff: number; pct: number | null; dir: "up" | "down" | "flat" };

/** Bu ay – önceki ay farkı. Önceki ay 0 ise yüzde verilmez (sahte "∞%" yok). */
export function compareMonths(current: number, previous: number): Delta {
  const diff = current - previous;
  return {
    diff,
    pct: previous > 0 ? Math.round((diff / previous) * 100) : null,
    dir: diff > 0 ? "up" : diff < 0 ? "down" : "flat",
  };
}

export type CountableRow = { at: string };

/** ISO zaman damgası verilen aralıkta mı: [startIso, endIso). */
export function inRange(iso: string | null | undefined, startIso: string, endIso: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= Date.parse(startIso) && t < Date.parse(endIso);
}

export function countInRange(rows: readonly CountableRow[], startIso: string, endIso: string): number {
  let n = 0;
  for (const r of rows) if (inRange(r.at, startIso, endIso)) n += 1;
  return n;
}

export type TimelineKind = "call" | "appointment" | "task" | "offer";

export type TimelineEvent = {
  key: string;
  kind: TimelineKind;
  title: string;
  sub: string | null;
  at: string;
  href: string;
};

/** Olayları en yeniden eskiye sıralar; geçersiz tarihleri atar, eşitlikte kararlı. */
export function buildTimeline(events: readonly TimelineEvent[], limit: number): TimelineEvent[] {
  return events
    .filter((e) => Number.isFinite(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export type PipelineStage = { stage: string; count: number; value: number };

const OPEN_STAGES = ["new", "qualified", "negotiation"] as const;

/** Kendi açık anlaşmalarının aşama dağılımı (won/lost hariç); sıra aşama sırasıdır. */
export function openPipeline(deals: readonly { stage: string; deal_value: number | string | null }[]): PipelineStage[] {
  return OPEN_STAGES.map((stage) => {
    const hit = deals.filter((d) => d.stage === stage);
    return { stage, count: hit.length, value: hit.reduce((s, d) => s + (Number(d.deal_value) || 0), 0) };
  });
}

/**
 * Takipsiz talep: açık talebi olan, ama o müşteri için hiç AÇIK görevi bulunmayan müşteri.
 * Girdi: açık talebi olan müşteri kimlikleri + açık görevi olan müşteri kimlikleri.
 */
export function untrackedCustomerIds(
  demandCustomerIds: readonly (string | null)[],
  openTaskCustomerIds: readonly (string | null)[],
): string[] {
  const tracked = new Set(openTaskCustomerIds.filter((v): v is string => Boolean(v)));
  const out = new Set<string>();
  for (const id of demandCustomerIds) if (id && !tracked.has(id)) out.add(id);
  return [...out];
}

export type AttentionInput = { overdueTasks: number | null; untrackedDemands: number | null };

/** Dikkat nedenleri (boşsa dikkat gerekmez). Veri null ise o neden değerlendirilmez. */
export function attentionReasons(i: AttentionInput): string[] {
  const out: string[] = [];
  if (i.overdueTasks !== null && i.overdueTasks >= ATTENTION_OVERDUE_TASKS) out.push(`${i.overdueTasks} gecikmiş görev`);
  if (i.untrackedDemands !== null && i.untrackedDemands >= ATTENTION_UNTRACKED_DEMANDS) out.push(`${i.untrackedDemands} takipsiz talep`);
  return out;
}
