import type { PlanUsageRow } from "@/lib/nav-badges";

/**
 * Yan menü ofis durumu çipinin SAF kararı (admin `system-status.ts` deseni). Girdi yalnız kabukta zaten olan veri:
 * deneme bayrağı + kalan gün (trial_ends_at) ve paket kullanımı (limitsiz kalemler gelmez).
 *  - Deneme sürüyorsa kısa metin "N gün" (doldu ise "Doldu"), çubuk deneme değil en dolu kullanım oranıdır.
 *  - Deneme yoksa kısa metin en dolu kalemin yüzdesi ("%82"); kalem yoksa metin ve çubuk yok.
 *  - Düzey: süre dolmuş deneme ya da ≥%90 kullanım = danger; ≥%75 ya da deneme = warn; aksi ok.
 */
export type OfficeStatusLevel = "ok" | "warn" | "danger";

export type OfficeStatus = {
  level: OfficeStatusLevel;
  /** Çipte paket adının yanındaki kısa metin; gösterilecek bir şey yoksa null. */
  short: string | null;
  /** En dolu kullanım oranı (0..1); kullanım kalemi yoksa null (çubuk çizilmez). */
  ratio: number | null;
};

export function usageRatio(u: Pick<PlanUsageRow, "used" | "limit">): number {
  return u.limit > 0 ? Math.min(1, Math.max(0, u.used / u.limit)) : 0;
}

export function officeStatusOf(input: {
  trial: boolean;
  trialDaysLeft: number | null;
  usage: readonly PlanUsageRow[];
}): OfficeStatus {
  const ratio = input.usage.length > 0 ? Math.max(...input.usage.map(usageRatio)) : null;
  const expired = input.trial && input.trialDaysLeft != null && input.trialDaysLeft <= 0;
  const level: OfficeStatusLevel =
    expired || (ratio ?? 0) >= 0.9 ? "danger" : (ratio ?? 0) >= 0.75 || input.trial ? "warn" : "ok";
  let short: string | null = null;
  if (input.trial) short = input.trialDaysLeft == null ? "Deneme" : expired ? "Doldu" : `${input.trialDaysLeft} gün`;
  else if (ratio != null) short = `%${Math.round(ratio * 100)}`;
  return { level, short, ratio };
}
