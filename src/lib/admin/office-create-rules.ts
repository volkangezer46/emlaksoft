import type { PlanId } from "@/lib/billing/plans";
import { defaultTeamSizeForPlan, type RegistrationTeamSize } from "@/lib/billing/registration-plan";
import { ROLE_LABELS } from "@/lib/role-labels";
import { DEFAULT_TRIAL_DAYS } from "@/lib/platform-setting-keys";

/**
 * Platform yönetiminden ofis açma kuralları (saf; form ve sunucu action'ı ortak kullanır, zod içermez).
 *
 * Deneme süresi varsayılanı kayıt akışındaki mevcut kuraldır (14 gün; provizyon RPC'leri de 14 gün yazar).
 * Farklı bir süre seçilirse provizyondan SONRA deneme bitişi güncellenir.
 */
/** Tek kaynak: Ayar Kayit Defteri varsayilani (platform-setting-keys DEFAULT_TRIAL_DAYS = 14). SQL platform_default_trial_days() ayri kalir. */
export const OFFICE_TRIAL_DEFAULT_DAYS: number = DEFAULT_TRIAL_DAYS;
export const OFFICE_TRIAL_MIN_DAYS = 1;
export const OFFICE_TRIAL_MAX_DAYS = 90;
export const OFFICE_TRIAL_PRESETS = [7, 14, 30, 60] as const;

export const OFFICE_ACCESS_MODES = ["link", "link_temp"] as const;
export type OfficeAccessMode = (typeof OFFICE_ACCESS_MODES)[number];

export const OFFICE_ACCESS_MODE_LABELS: Record<OfficeAccessMode, string> = {
  link: "Şifre belirleme bağlantısı (e-posta)",
  link_temp: "E-posta bağlantısı + geçici parola",
};

export const OFFICE_INITIAL_STATUSES = ["trial", "active"] as const;
export type OfficeInitialStatus = (typeof OFFICE_INITIAL_STATUSES)[number];

export const OFFICE_INITIAL_STATUS_LABELS: Record<OfficeInitialStatus, string> = {
  trial: "Deneme",
  active: "Aktif",
};

/** Sahte satış kaydının kaynağı: demo listesinde platformdan açılan ofisler bu etiketle ayrışır. */
export const OFFICE_ADMIN_CREATE_SOURCE = "admin_office_create";

/**
 * Atomik provizyon RPC'si paketi ekip büyüklüğünden türetir (1 -> Danışman, 2-10 -> Ofis,
 * 10-50 -> Profesyonel, 50+ -> Kurumsal). Seçilen paketi üretecek ekip büyüklüğü bandı.
 */
export function teamSizeForPlan(plan: PlanId): RegistrationTeamSize {
  return defaultTeamSizeForPlan(plan);
}

export function clampTrialDays(value: number): number {
  if (!Number.isFinite(value)) return OFFICE_TRIAL_DEFAULT_DAYS;
  return Math.min(OFFICE_TRIAL_MAX_DAYS, Math.max(OFFICE_TRIAL_MIN_DAYS, Math.round(value)));
}

/** `fromMs` anından `days` gün sonrası (ISO). Zaman çağırandan gelir (bileşende Date.now yasak). */
export function trialEndIso(fromMs: number, days: number): string {
  return new Date(fromMs + clampTrialDays(days) * 86_400_000).toISOString();
}

/** Platformdan atanabilen ofis rolleri (`owner` yalnız sahiplik devriyle değişir; team.ts ASSIGNABLE_ROLES ile aynı). */
export const OFFICE_USER_ROLES = ["gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"] as const;
export type OfficeUserRole = (typeof OFFICE_USER_ROLES)[number];

export const OFFICE_ROLE_LABELS: Record<string, string> = ROLE_LABELS; // tek kaynak: lib/role-labels.ts

/** Ofis durumu etiketleri (tenants.status). "cancelled" arşiv anlamında kullanılır: veri silinmez. */
export const OFFICE_STATUS_LABELS: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  past_due: "Ödeme gecikmiş",
  suspended: "Askıda",
  cancelled: "Arşiv (iptal)",
};

/** Vergi numarası: 10 haneli VKN ya da 11 haneli TCKN (şahıs işletmesi). */
export const TAX_NUMBER_RE = /^\d{10,11}$/;

/** Arşivleme / sahiplik devri gibi eylemlerde "ofis adını yazarak onay" karşılaştırması. */
export function confirmationMatches(typed: string | null | undefined, expected: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
  const t = norm(typed ?? "");
  return t.length > 0 && t === norm(expected);
}
