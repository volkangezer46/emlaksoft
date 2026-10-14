import { baseRoleOf, platformCan, platformCanAccess, type PlatformAccessSubject } from "@/lib/platform-access";

/**
 * Platform personelinin OFİS YÖNETİMİ eylem matrisi (saf; sunucu action'ları ve arayüz aynı kaynağı kullanır).
 *
 * Kural: her eylem önce "tenants" modülünü ister (tüm roller görür); eylem bazında:
 *  - Ofis açma kapısı, demo dönüşümü (`convertDemoToTenant`) ile AYNI: "sales" modülü.
 *    Veritabanı tarafı da aynı listeyi ister (`convert_demo_request_to_tenant`: super_admin, ops, support).
 *  - Paket/durum/deneme: "billing" modülü (`update_tenant_plan_subscription` RPC'si super_admin + billing ister).
 *  - Yıkıcı ya da hesap ele geçirmeye açık eylemler (askıya alma, arşivleme, vitrin adresi değişimi,
 *    sahip e-postası, sahiplik devri, kullanıcı pasifleştirme) YALNIZ süper admin.
 */
export const OFFICE_ADMIN_ACTIONS = [
  "create",
  "create_active",
  "edit_profile",
  "edit_billing_profile",
  "change_slug",
  "plan_status",
  "suspend",
  "reactivate",
  "resend_access",
  "change_owner_email",
  "transfer_ownership",
  "add_user",
  "deactivate_user",
  "reactivate_user",
  "note",
  "archive",
  "restore",
  "export_vault",
] as const;

export type OfficeAdminAction = (typeof OFFICE_ADMIN_ACTIONS)[number];

const SUPER_ONLY: ReadonlySet<OfficeAdminAction> = new Set([
  "change_slug",
  "suspend",
  "change_owner_email",
  "transfer_ownership",
  "deactivate_user",
  "archive",
  "restore",
]);

export function officeAdminCan(who: PlatformAccessSubject, action: OfficeAdminAction): boolean {
  const role = baseRoleOf(who);
  if (!platformCanAccess(who, "tenants")) return false;
  if (role === "super_admin") return true;
  // DG1: yazma eylemleri modülde `write`, yıkıcı olanlar `approve` ister (sabit rollerde approve yalnız süper adminde).
  if (!platformCan(who, "tenants", "write")) return false;
  if (SUPER_ONLY.has(action)) return platformCan(who, "tenants", "approve");
  switch (action) {
    case "create":
    case "resend_access":
      return platformCan(who, "sales", "write");
    case "create_active":
      return platformCan(who, "sales", "write") && platformCan(who, "billing", "write");
    case "edit_profile":
      return role === "ops" || role === "support";
    case "edit_billing_profile":
    case "plan_status":
    case "reactivate":
      return platformCan(who, "billing", "write");
    case "add_user":
    case "reactivate_user":
      return platformCan(who, "members", "write");
    case "note":
      return true;
    case "export_vault":
      return role === "ops";
    default:
      return false;
  }
}

/** Rolün yapabildiği eylemler (Yönetim sekmesi yalnız bunları çizer). */
export function officeAdminActionsFor(who: PlatformAccessSubject): OfficeAdminAction[] {
  return OFFICE_ADMIN_ACTIONS.filter((a) => officeAdminCan(who, a));
}

export const OFFICE_ADMIN_DENIED = "Bu işlem için yetkiniz yok.";
