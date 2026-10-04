/**
 * Ofis vitrin ayarları — SAF mantık (sunucu action'ı, public vitrin, sitemap ve birim test ortak kullanır).
 * Depo: tenants.vitrin_* sütunları (supabase/proposed taslakları). Sütunlar yokken özellik "etkin değil"dir
 * ve public vitrin bugünkü davranışını korur (VITRIN_DEFAULTS).
 */

export const VITRIN_INTRO_MAX = 600;

export const VITRIN_COLUMNS =
  "vitrin_intro, vitrin_enabled, vitrin_show_phone, vitrin_show_lead_form, vitrin_show_valuation, vitrin_seo_optin";

export type VitrinSettings = {
  intro: string | null;
  /** false: public vitrin kapalı (404). */
  enabled: boolean;
  showPhone: boolean;
  showLeadForm: boolean;
  showValuation: boolean;
  /** Arama motorlarında (sitemap) görünme onayı. Varsayılan KAPALI. */
  seoOptin: boolean;
};

/** Sütunlar yokken public vitrinin bugünkü davranışı: her şey açık, tanıtım yok, arama onayı yok. */
export const VITRIN_DEFAULTS: VitrinSettings = {
  intro: null,
  enabled: true,
  showPhone: true,
  showLeadForm: true,
  showValuation: true,
  seoOptin: false,
};

export type VitrinSettingsState = { available: boolean; settings: VitrinSettings };

/** PostgREST/Postgres "sütun yok" hatası mı? (migration henüz uygulanmamış) */
export function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "PGRST204") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("vitrin_") && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"));
}

export function normalizeIntro(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  return s ? s : null;
}

/** Ham satırdan (select sonucu) ayarlar; eksik/bozuk alan varsayılana düşer. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): VitrinSettings {
  if (!row) return { ...VITRIN_DEFAULTS };
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const intro = typeof row.vitrin_intro === "string" ? normalizeIntro(row.vitrin_intro) : null;
  return {
    intro,
    enabled: bool(row.vitrin_enabled, VITRIN_DEFAULTS.enabled),
    showPhone: bool(row.vitrin_show_phone, VITRIN_DEFAULTS.showPhone),
    showLeadForm: bool(row.vitrin_show_lead_form, VITRIN_DEFAULTS.showLeadForm),
    showValuation: bool(row.vitrin_show_valuation, VITRIN_DEFAULTS.showValuation),
    seoOptin: bool(row.vitrin_seo_optin, VITRIN_DEFAULTS.seoOptin),
  };
}

export type VitrinValidation = { ok: true; settings: VitrinSettings } | { ok: false; error: string };

/** Form girdisini doğrular. Anahtarlar yalnız açıkça "on" ise true olur (arama onayı varsayılan kapalı). */
export function validateVitrinInput(input: {
  intro: unknown;
  enabled: unknown;
  showPhone: unknown;
  showLeadForm: unknown;
  showValuation: unknown;
  seoOptin: unknown;
}): VitrinValidation {
  const on = (v: unknown) => v === "on" || v === "true" || v === true;
  const intro = normalizeIntro(input.intro);
  if (intro && intro.length > VITRIN_INTRO_MAX) {
    return { ok: false, error: `Tanıtım metni en fazla ${VITRIN_INTRO_MAX} karakter olabilir.` };
  }
  return {
    ok: true,
    settings: {
      intro,
      enabled: on(input.enabled),
      showPhone: on(input.showPhone),
      showLeadForm: on(input.showLeadForm),
      showValuation: on(input.showValuation),
      seoOptin: on(input.seoOptin),
    },
  };
}

/**
 * Sitemap opt-in slug kümesi — TEK KAYNAK kuralı:
 *  - Sütun mevcutsa (ofis ayarı kullanılabilir): yalnız `vitrin_seo_optin=true` ofisler girer; elle liste YOK SAYILIR.
 *  - Sütun yoksa (migration uygulanmadı): eski elle liste geçerlidir (davranış değişmez).
 */
export function resolveOptInSlugs(input: {
  columnAvailable: boolean;
  manualSlugs: readonly string[];
  tenants: readonly { slug: string | null; seoOptin: boolean }[];
}): string[] {
  if (!input.columnAvailable) return [...input.manualSlugs];
  const out = new Set<string>();
  for (const t of input.tenants) if (t.slug && t.seoOptin) out.add(t.slug);
  return [...out];
}
