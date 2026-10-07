/**
 * Teklif geçerlilik bitimi kuralları (saf; cron adımı `offer-expiry-reminders.ts` ve teklif ekranları kullanır).
 * Geçerlilik `offers.valid_until` bir TAKVİM GÜNÜDÜR (date); karşılaştırmalar TR gün anahtarıyla yapılır.
 */
export const OFFER_REMINDER_DAYS_BEFORE = 2;

/** Hatırlatma yalnız yanıt bekleyen tekliflere: taslak, gönderildi, karşı teklif. */
export const OFFER_REMINDER_STATUSES = ["draft", "submitted", "countered"] as const;

/** "YYYY-MM-DD" + n gün (UTC parça aritmetiği; saat dilimi kayması yok). */
export function addDaysToKey(dayKey: string, days: number): string {
  const ms = Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Bugün (TR gün anahtarı) çalışan adımın aradığı geçerlilik günü. */
export function offerExpiryTargetDay(todayKey: string): string {
  return addDaysToKey(todayKey, OFFER_REMINDER_DAYS_BEFORE);
}

export function offerExpiryDedupeKey(offerId: string, validUntil: string): string {
  return `offer-exp:${offerId}:${validUntil}`;
}

/** Ekran rozeti: açık teklifin geçerliliğine kalan gün (geçmişse negatif); tarih yoksa null. */
export function daysUntilOfferExpiry(validUntil: string | null | undefined, todayKey: string): number | null {
  if (!validUntil || !/^\d{4}-\d{2}-\d{2}/.test(validUntil)) return null;
  const a = Date.parse(`${validUntil.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${todayKey}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}
