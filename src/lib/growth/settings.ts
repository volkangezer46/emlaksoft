/**
 * Büyüme programı ayarları: anahtarlar ve saf çözümleyiciler.
 * Depo: `platform_settings` (şema gerektirmez). Ödül tutarı/oranı KODDA YOKTUR:
 * yalnız admin'in tanımladığı `growth_reward_rules` satırından okunur; program varsayılan KAPALIdır.
 */
export const GROWTH_SETTING_KEYS = {
  referralEnabled: "growth_referral_enabled",
  partnerEnabled: "growth_partner_enabled",
} as const;

export type GrowthFlags = { referralEnabled: boolean; partnerEnabled: boolean };

export const GROWTH_FLAGS_OFF: GrowthFlags = { referralEnabled: false, partnerEnabled: false };

function on(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

/** Boş/bilinmeyen = KAPALI (güvenli varsayılan). */
export function parseGrowthFlags(raw: Record<string, string | null | undefined>): GrowthFlags {
  return {
    referralEnabled: on(raw[GROWTH_SETTING_KEYS.referralEnabled]),
    partnerEnabled: on(raw[GROWTH_SETTING_KEYS.partnerEnabled]),
  };
}

export type RewardRuleView = {
  reward_type: "fixed_try" | "percent_of_payment";
  reward_value: number;
  duration_months: number | null;
  hold_days: number;
};

/**
 * Kural satırından insan okunur ödül cümlesi. Sayılar yalnız kuraldan gelir; kural yoksa null
 * (çağıran ödül vaadi göstermez).
 */
export function describeRewardRule(rule: RewardRuleView | null | undefined): string | null {
  if (!rule || !(rule.reward_value > 0)) return null;
  const value = Number.isInteger(rule.reward_value)
    ? String(rule.reward_value)
    : rule.reward_value.toFixed(2).replace(".", ",");
  const what =
    rule.reward_type === "fixed_try"
      ? `${value} TL hesap kredisi`
      : `ödemenin %${value}'i kadar hesap kredisi`;
  const dur = rule.duration_months ? ` (ilk ${rule.duration_months} ay)` : "";
  const hold = rule.hold_days > 0 ? `, ödeme sonrası ${rule.hold_days} gün bekleme süresinden sonra` : "";
  return `${what}${dur}${hold}`;
}

/** "Tablo/fonksiyon yok" hatası mı? (taslak migration uygulanmamışsa sayfalar bozulmaz) */
export function isMissingTableError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883") return true;
  return /does not exist|schema cache|could not find the (table|function)/i.test(err.message ?? "");
}
