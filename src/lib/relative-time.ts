import { msSince } from "@/lib/clock";

/**
 * Türkçe göreli zaman ("Az önce", "12 dk önce", "Dün", "3 gün önce") — gelen kutusu ve konuşmalar için tek kopya.
 * Saat `clock.ts` üzerinden okunur (bileşende doğrudan Date.now() yasak).
 */
export function relativeTimeTr(iso: string): string {
  const mins = Math.floor(msSince(iso) / 60_000);
  if (mins < 1) return "Az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Dün";
  if (days < 30) return `${days} gün önce`;
  if (days < 365) return `${Math.floor(days / 30)} ay önce`;
  return `${Math.floor(days / 365)} yıl önce`;
}

/** Bekleme süresi kısa etiketi ("40 dk", "3 sa", "2 gün") ve SLA tonu (≤1 sa normal, ≤24 sa uyarı, üstü acil). */
export function waitingLabel(iso: string): { text: string; tone: "normal" | "warn" | "urgent" } {
  const mins = Math.max(0, Math.floor(msSince(iso) / 60_000));
  const text = mins < 60 ? `${Math.max(1, mins)} dk` : mins < 24 * 60 ? `${Math.floor(mins / 60)} sa` : `${Math.floor(mins / (24 * 60))} gün`;
  const tone = mins <= 60 ? "normal" : mins <= 24 * 60 ? "warn" : "urgent";
  return { text, tone };
}
