import type { NavBadge } from "@/lib/nav-badges";

/** Gelen kutusu menü öğesi (rozetin ait olduğu merkez sayfası). */
export const INBOX_ITEM_HREF = "/app/gelen-kutusu";

/** Rozet tıklama hedefi: "Yanıt bekliyor" (varsayılan durum) + kişisel kapsamda "Bana atananlar". */
export function inboxBadgeHref(mine: boolean): string {
  return mine ? `${INBOX_ITEM_HREF}?danisman=ben` : INBOX_ITEM_HREF;
}

/** Sayı → menü rozeti (0 ya da bilinmiyorsa rozet yok). Yanıt bekleyen konuşma "uyarı" tonundadır, gecikme değil. */
export function inboxNavBadge(state: { count: number; href: string } | null): NavBadge | null {
  if (!state || !(state.count > 0)) return null;
  return { itemHref: INBOX_ITEM_HREF, href: state.href, count: state.count, label: "yanıt bekliyor", tone: "warn" };
}

/** Rozet tazeleme aralığı: gezintide en çok bu sıklıkla sorulur (kabuk akışı beklemez). */
export const INBOX_BADGE_TTL_MS = 60_000;
