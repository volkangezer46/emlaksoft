import { DAY_MS } from "@/lib/clock";

/**
 * Deneme süresi görünümü — SAF. Kabuk şeridi ve kurulum sayfaları aynı hesabı kullanır
 * (abonelik sayfası ve yan menü de `msUntil / DAY_MS` tavanını kullanır; formül aynıdır).
 */

/** Kalan tam gün (yukarı yuvarlanır, en az 0). Bitiş yoksa null. */
export function trialDaysLeft(trialEndsAt: string | Date | null | undefined, nowMs: number): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - nowMs) / DAY_MS));
}

/** Şeridin tek satırlık deneme metni. */
export function trialLabel(daysLeft: number | null): string | null {
  if (daysLeft == null) return null;
  if (daysLeft <= 0) return "Deneme süresi doldu";
  if (daysLeft === 1) return "Deneme: son gün";
  return `${daysLeft} gün deneme kaldı`;
}

/** Son 3 gün ve son gün vurgulanır (cron hatırlatma kademeleriyle aynı eşikler: trial3 / trial1). */
export function trialUrgency(daysLeft: number | null): "none" | "soon" | "last" {
  if (daysLeft == null) return "none";
  if (daysLeft <= 1) return "last";
  if (daysLeft <= 3) return "soon";
  return "none";
}
