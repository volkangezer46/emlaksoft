import { notificationNeedsAttention } from "@/lib/notification-text";

/**
 * Karar gerektiren bildirim (C10/C22, plan 2.3) — SUNUCU ve istemci için SAF kural: onay bekleyen, size atanan,
 * geciken iş ve yanıt bekleyen randevu talebi. Zil rozeti (`notification-bell.tsx`) aynı kuralı uygular;
 * `notification-decision.test.ts` iki kopyanın aynı sonucu verdiğini kilitler. Bildirimler sayfasının
 * "Sizden karar bekleyenler" bölümü bu kümeyi listenin başına alır.
 */
const DECISION_TITLE_RE = /(?:atandı|gecik)/iu;

export function isDecisionNotification(n: { href: string | null; title: string }): boolean {
  if (notificationNeedsAttention(n)) return true;
  if ((n.href ?? "").startsWith("/app/onaylar")) return true;
  return DECISION_TITLE_RE.test(n.title);
}

/**
 * Bildirim sayfası satırlarını ikiye ayırır: okunmamış karar bildirimleri (en çok `limit`, sayfa sırası korunur) ve
 * kalanlar. Okunmuş karar bildirimi "diğer" listede kalır (karar verildi ya da görüldü).
 */
export function splitDecisionFirst<T extends { href: string | null; title: string; read_at: string | null }>(
  rows: readonly T[],
  limit = 5,
): { decisions: T[]; rest: T[] } {
  const decisions: T[] = [];
  const rest: T[] = [];
  for (const r of rows) {
    if (decisions.length < limit && !r.read_at && isDecisionNotification(r)) decisions.push(r);
    else rest.push(r);
  }
  return { decisions, rest };
}
