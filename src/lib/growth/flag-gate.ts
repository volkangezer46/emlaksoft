import "server-only";
import { getAdminGrowthOverview, getGrowthFlags } from "@/lib/growth/store";
import { readinessBlockers } from "@/lib/growth/program";

/** Özellik bayrağı anahtarı → büyüme programı (registry `growth_*` bayrakları). */
const GROWTH_FLAG_PROGRAM = {
  growth_referral: "referral",
  growth_partner: "partner",
  growth_cash_payout: "cash",
} as const;

/**
 * Büyüme programı bayrağını AÇMA kapısı (Ayarlar > Özellik bayrakları tek düzenleme yeridir). KAPALI -> AÇIK geçişinde
 * hazırlık kontrolü ZORUNLUDUR: engelleyici madde (migration/cüzdan/kural) varsa açılmaz. Nakit ödeme yalnız ortak
 * programı açıkken açılabilir. Büyüme bayrağı değilse ya da kapatılıyorsa null (engel yok).
 */
export async function growthFlagOpenError(flagKey: string, on: boolean): Promise<string | null> {
  const program = (GROWTH_FLAG_PROGRAM as Record<string, "referral" | "partner" | "cash" | undefined>)[flagKey];
  if (!program || !on) return null;
  const before = await getGrowthFlags();
  if (program === "cash" && !before.partnerEnabled) return "Nakit ödeme yalnız ortak programı açıkken açılabilir.";
  const already = program === "referral" ? before.referralEnabled : program === "partner" ? before.partnerEnabled : before.cashPayoutEnabled;
  if (already) return null;
  const ov = await getAdminGrowthOverview();
  const checks = ov.readiness[program];
  const blockers = readinessBlockers(checks);
  if (blockers.length) {
    const names = [...new Set(blockers.map((b) => b.label))].join("; ");
    return `Hazırlık kontrolü geçmedi, program açılamaz: ${names}.`;
  }
  return null;
}
