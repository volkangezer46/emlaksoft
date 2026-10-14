/**
 * AD11 kritik işlem yeniden doğrulaması (SAF parça): ayar anahtarı, alan adı, kritik işlem listesi ve kod biçimi.
 * Sunucu doğrulaması `step-up.ts`; istemci alanı `StepUpCodeField` (`src/components/admin/step-up-code-field.tsx`).
 */
export const STEP_UP_REQUIRED_KEY = "platform.step_up_required";
export const STEP_UP_FIELD = "step_up_code";

/** Kritik işlemler: iade, kredi, sahiplik devri, ofis kapatma, rol değişikliği (denetim izinde bu ad yazılır). */
export const STEP_UP_ACTIONS = {
  refund: "İade",
  chargeback: "Ters ibraz",
  credit_grant: "Hesap kredisi verme",
  credit_reverse: "Hesap kredisi geri alma",
  ownership_transfer: "Ofis sahipliği devri",
  office_close: "Ofis kapatma / askıya alma",
  staff_role: "Personel rol değişikliği",
  member_role: "Ofis kullanıcısı rol değişikliği",
  security_policy: "Kritik işlem doğrulamasını kapatma",
  office_security_reset: "Ofis güvenlik politikasını sıfırlama",
} as const;
export type StepUpAction = keyof typeof STEP_UP_ACTIONS;

/** 6 haneli TOTP kodu (boşluk/tire atılır); geçersizse null. */
export function normalizeStepUpCode(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(s) ? s : null;
}

/** Ofis kapatma sayılan abonelik durumları (askıya alma / iptal-arşiv). */
export const OFFICE_CLOSE_STATUSES: readonly string[] = ["suspended", "cancelled"];

/**
 * Durum geçişi kod ister mi? Yalnız ofisi askıya alan/kapatan YENİ geçiş (aynı durumda kalan paket değişikliği istemez).
 * Sunucu (`updateTenantPlanStatus`) ve satır içi tablo aynı kuralı kullanır.
 */
export function statusChangeNeedsStepUp(next: string | null | undefined, current: string | null | undefined): boolean {
  return !!next && OFFICE_CLOSE_STATUSES.includes(next) && next !== current;
}
