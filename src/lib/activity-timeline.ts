import { trDayKey, trParts } from "@/lib/clock";

/**
 * Ortak olay akışı (Zaman çizelgesi) saf mantığı: süzme, TR gün grupları,
 * sayfalama. Bileşen: `src/components/ui/activity-timeline.tsx`.
 */
export type TimelineTone = "neutral" | "success" | "warn" | "danger" | "info";

export type TimelineEvent = {
  id: string;
  /** ISO zaman damgası */
  at: string;
  category: string;
  title: string;
  detail?: string;
  actor?: string;
  ip?: string;
  /** ICON_NAMES anahtarı (bkz. activity-timeline.tsx); bilinmezse kategoriye göre varsayılan */
  icon?: string;
  tone?: TimelineTone;
  href?: string;
};

export type TimelineDayGroup = { dayKey: string; heading: string; events: TimelineEvent[] };

const MONTHS_UPPER = ["OCA", "ŞUB", "MAR", "NİS", "MAY", "HAZ", "TEM", "AĞU", "EYL", "EKİ", "KAS", "ARA"] as const;

/** "3 EKİ 2026" — Türkiye gününe göre, büyük harf. */
export function dayHeading(value: string | number | Date): string {
  const p = trParts(value);
  return `${p.day} ${MONTHS_UPPER[p.month]} ${p.year}`;
}

function atMs(e: TimelineEvent): number {
  const t = new Date(e.at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Yeniden eskiye sıralar (kararlı: eşit anda id'ye göre). Girdiyi değiştirmez. */
export function sortEventsDesc(events: readonly TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => atMs(b) - atMs(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Kategori süzgeci; boş/"all"/"tumu" hepsini döner. */
export function filterByCategory(events: readonly TimelineEvent[], category?: string | null): TimelineEvent[] {
  if (!category || category === "all" || category === "tumu") return [...events];
  return events.filter((e) => e.category === category);
}

/** Kategori başına olay sayısı. */
export function countByCategory(events: readonly TimelineEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.category] = (out[e.category] ?? 0) + 1;
  return out;
}

/** TR gün sınırına göre gruplar (yeni → eski). Geçersiz tarihli olaylar atlanır. */
export function groupEventsByDay(events: readonly TimelineEvent[]): TimelineDayGroup[] {
  const groups: TimelineDayGroup[] = [];
  for (const e of sortEventsDesc(events)) {
    if (Number.isNaN(new Date(e.at).getTime())) continue;
    const key = trDayKey(e.at);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === key) last.events.push(e);
    else groups.push({ dayKey: key, heading: dayHeading(e.at), events: [e] });
  }
  return groups;
}

/** Sıralı ilk `pageSize` olay + devamı var mı. pageSize ≤ 0 → sınırsız. */
export function pageEvents(events: readonly TimelineEvent[], pageSize?: number): { visible: TimelineEvent[]; hasMore: boolean } {
  const sorted = sortEventsDesc(events);
  if (!pageSize || pageSize <= 0 || sorted.length <= pageSize) return { visible: sorted, hasMore: false };
  return { visible: sorted.slice(0, pageSize), hasMore: true };
}

/** `?kategori=` değerini geçerli anahtarlara karşı doğrular; geçersizse "" (Tümü). */
export function resolveCategory(raw: string | string[] | undefined, keys: readonly string[]): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && keys.includes(v) ? v : "";
}
