/**
 * Portföy yetkisi (properties.authorization_end) bitiş hatırlatması — SAF kural (saat/DB yok, birim testli).
 * Kademeler: "30" (8-30 gün kala), "7" (1-7 gün kala), "0" (bugün bitiyor ya da en çok 3 gün önce bitti).
 * Günlük cron bir gün kaçırsa da kademe pencere içinde yakalanır; tekrar bildirimi tek seferlik anahtar engeller.
 */
export type AuthorityStep = "30" | "7" | "0";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function daysBetween(fromKey: string, toKey: string): number | null {
  if (!ISO_DATE.test(fromKey) || !ISO_DATE.test(toKey)) return null;
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

export function authorityReminderStep(endDate: string | null | undefined, todayKey: string): AuthorityStep | null {
  if (!endDate) return null;
  const left = daysBetween(todayKey, endDate.slice(0, 10));
  if (left === null) return null;
  if (left > 30) return null;
  if (left >= 8) return "30";
  if (left >= 1) return "7";
  if (left >= -3) return "0";
  return null;
}

export function authorityReminderTitle(step: AuthorityStep, label: string, daysLeft: number): string {
  const name = label.slice(0, 80) || "Portföy";
  if (step === "0") return daysLeft < 0 ? `Portföy yetkisi doldu: ${name}` : `Portföy yetkisi bugün bitiyor: ${name}`;
  return `Portföy yetkisi ${daysLeft} gün içinde bitiyor: ${name}`;
}

export function authorityDedupeKey(propertyId: string, endDate: string, step: AuthorityStep, userId: string): string {
  return `auth-exp:${propertyId}:${endDate.slice(0, 10)}:${step}:${userId}`;
}
