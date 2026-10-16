import { DAY_MS, trDayKey, trParts } from "@/lib/clock";

/**
 * Yeni açık ev formunun akıllı varsayılan zamanı: sıradaki Cumartesi 13:00 (Türkiye saati) — açık ev günleri pratikte
 * hafta sonu öğleden sonra yapılır. Bugün Cumartesi ise bir sonraki hafta (aynı gün hazırlık için çok geç).
 * Çıktı `datetime-local` biçimi ("YYYY-MM-DDTHH:MM"); sunucu bu değeri TR saati olarak yorumlar.
 */
export function defaultOpenHouseStart(nowMs: number): string {
  const weekday = trParts(nowMs).weekday; // 0 Pazar … 6 Cumartesi
  const daysAhead = (6 - weekday + 7) % 7 || 7;
  return `${trDayKey(nowMs + daysAhead * DAY_MS)}T13:00`;
}
