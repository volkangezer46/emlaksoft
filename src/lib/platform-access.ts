/**
 * EmlakSoft iç personeli (platform_staff) departman erişim modeli.
 * Tenant tarafındaki rol×modül matrisinin platform karşılığı: her departman yalnızca
 * kendi ekranlarını görür. Bu dosya SUNUCU/İSTEMCİ ortak kullanılabilir (saf, yan etkisiz).
 */

export type PlatformRole = "super_admin" | "ops" | "support" | "billing";

export type PlatformModule =
  | "dashboard"
  | "sales"
  | "tenants"
  | "members"
  | "billing"
  | "tickets"
  | "reports"
  | "advisor"
  | "activity"
  | "geo"
  | "sistem"
  | "broadcast"
  | "personel";

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: "Süper admin",
  ops: "Operasyon",
  support: "Müşteri temsilcisi",
  billing: "Muhasebe",
};

/** Departmanların kısa açıklaması (sidebar/başlık için). */
export const PLATFORM_ROLE_TAGLINES: Record<PlatformRole, string> = {
  super_admin: "Tam yetki · tüm platform",
  ops: "Tenant operasyonu & sistem",
  support: "Destek kuyruğu & müşteri",
  billing: "Abonelik, fatura & gelir",
};

/**
 * Rol → erişilebilir modüller. `dashboard` herkeste var; içeriği role göre uyarlanır.
 */
export const PLATFORM_ROLE_MODULES: Record<PlatformRole, PlatformModule[]> = {
  super_admin: ["dashboard", "sales", "tenants", "members", "billing", "tickets", "reports", "advisor", "activity", "geo", "sistem", "broadcast", "personel"],
  ops: ["dashboard", "sales", "tenants", "members", "tickets", "reports", "advisor", "activity", "geo", "sistem", "broadcast"],
  billing: ["dashboard", "billing", "tenants", "reports", "advisor"],
  support: ["dashboard", "sales", "tickets", "members", "tenants"],
};

export function platformModulesFor(role: PlatformRole): PlatformModule[] {
  return PLATFORM_ROLE_MODULES[role] ?? ["dashboard"];
}

export function platformCanAccess(role: PlatformRole, module: PlatformModule): boolean {
  return platformModulesFor(role).includes(module);
}

/** Giriş sonrası departmanın varsayılan açılış ekranı. */
export function platformHome(role: PlatformRole): string {
  switch (role) {
    case "billing":
    case "support":
    case "ops":
    case "super_admin":
    default:
      // Dashboard role göre uyarlandığı için herkes /admin'e iner.
      return "/admin";
  }
}
