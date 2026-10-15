import { exportAllowedForRole } from "./policy";
import { readOfficeSecurityPolicyCached } from "./policy-cache";

/**
 * G4 dışa aktarma kapısı (sunucu): ofis güvenlik politikasındaki `office.security.export_roles`. Görüntüleme yetkisi
 * (modül/rapor kapıları) ayrıca denetlenir; bu yalnız "dosya olarak indirme" için ek kısıttır. Politika görüntüsü
 * proxy ile aynı önbellekten (≤30 sn) okunur; politika yoksa/varsayılandaysa herkes geçer (bugünkü davranış).
 */
export const EXPORT_ROLE_BLOCKED_MESSAGE =
  "Ofis güvenlik politikası rolünüz için dışa aktarmayı kapatmış. Raporu ekranda görebilirsiniz; dosya için ofis sahibinize başvurun.";

/** Engel metni ya da null (izinli). */
export async function officeExportBlock(tenantId: string | null | undefined, role: string | null | undefined): Promise<string | null> {
  if (!tenantId) return null;
  const policy = await readOfficeSecurityPolicyCached(tenantId);
  return exportAllowedForRole(policy, role) ? null : EXPORT_ROLE_BLOCKED_MESSAGE;
}
