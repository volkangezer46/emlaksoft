/**
 * Lig ayarları — SAF çözümleme. Ofis `league_settings.rules` ({kural: puan}) değerini varsayılanlarla birleştirir.
 *
 * KURALLAR:
 *  - Eksik / geçersiz anahtar varsayılan puana düşer (tablo yokken de ligin çalışmasının sözleşmesi).
 *  - Puan 0 = kural KAPALI (kayıt adet olarak da sayılmaz). Üst sınır 1000: tek kalemle ligin satın alınmasını önler.
 *  - Tutar bazlı sıralama (`showAmounts`) VARSAYILAN KAPALI (P12 kazanç gizliliği); yalnız yönetici açar.
 */
import { SCORE_RULES, SCORE_RULE_KEYS, type ScoreRuleKey, type ScoreRuleset } from "@/lib/gamification";

export const MAX_RULE_POINTS = 1000;

export type LeagueSettings = {
  ruleset: ScoreRuleset;
  /** Ofis varsayılandan farklı bir kural kaydetmiş mi (kural kartında "özelleştirilmiş" etiketi) */
  customized: boolean;
  showAmounts: boolean;
};

export const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  ruleset: SCORE_RULES,
  customized: false,
  showAmounts: false,
};

function cleanPoints(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(MAX_RULE_POINTS, Math.round(n)));
}

/** DB satırından (rules jsonb + show_amounts) çözümlenmiş ayar. Bozuk girdi sessizce varsayılana düşer. */
export function resolveLeagueSettings(row: { rules?: unknown; show_amounts?: unknown } | null | undefined): LeagueSettings {
  const rules = row && row.rules && typeof row.rules === "object" && !Array.isArray(row.rules)
    ? (row.rules as Record<string, unknown>)
    : {};
  const merged = { ...SCORE_RULES } as Record<ScoreRuleKey, number>;
  let customized = false;
  for (const key of SCORE_RULE_KEYS) {
    const v = cleanPoints(rules[key]);
    if (v === null) continue;
    if (v !== SCORE_RULES[key]) customized = true;
    merged[key] = v;
  }
  return { ruleset: merged, customized, showAmounts: row?.show_amounts === true };
}

/**
 * Ayar formundan gelen değeri sadece FARKLI olanlar saklanacak biçimde sadeleştirir
 * (varsayılan sonradan değişirse özelleştirmeyen ofis yeni varsayılana geçer).
 */
export function rulesToStore(input: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SCORE_RULE_KEYS) {
    const v = cleanPoints(input[key]);
    if (v === null) continue;
    if (v !== SCORE_RULES[key]) out[key] = v;
  }
  return out;
}
