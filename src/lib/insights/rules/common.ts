import { DAY_MS } from "@/lib/clock";
import type { InsightDraft } from "@/lib/insights/types";

/** Her kural alıcı başına en çok bu kadar içgörü üretir (liste büyürse okunmaz; advisor-coach "en fazla 4" ilkesi). */
export const MAX_PER_RECIPIENT_PER_RULE = 5;

export const dayMs = (n: number): number => n * DAY_MS;

/** "Taslak" sıralama için yardımcı: audience.user olanları alıcıya göre gruplayıp üst sınırı uygular. */
export function capPerUser<T extends { audience: InsightDraft["audience"] }>(
  items: readonly T[],
  max: number,
  rank: (a: T, b: T) => number,
): T[] {
  const byUser = new Map<string, T[]>();
  const rest: T[] = [];
  for (const it of items) {
    if (it.audience.type !== "user") {
      rest.push(it);
      continue;
    }
    const list = byUser.get(it.audience.userId) ?? [];
    list.push(it);
    byUser.set(it.audience.userId, list);
  }
  const out: T[] = [...rest];
  for (const list of byUser.values()) out.push(...list.sort(rank).slice(0, max));
  return out;
}

/** Kısa gün metni: 1 gün, 14 gün. */
export const gunText = (n: number): string => `${Math.max(0, Math.round(n))} gün`;

/** Metin içinde kullanılacak kişi adı (boş ise genel ifade). */
export const nameOr = (name: string | null | undefined, fallback: string): string => {
  const t = (name ?? "").trim();
  return t ? t.slice(0, 60) : fallback;
};
