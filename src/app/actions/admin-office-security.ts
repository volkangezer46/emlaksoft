"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { OFFICE_ADMIN_DENIED, officeAdminCan } from "@/lib/admin/office-admin-access";
import { requireStepUp } from "@/lib/platform-security/step-up";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { resetOfficeSecurity } from "@/lib/settings/office-security-write";

/**
 * DG7 acil kurtarma (Ofis 360 > Yönetim): ofis sahibi IP listesiyle kendini kilitlediğinde süper admin ofisin güvenlik
 * politikasını varsayılana döndürür. Süper admin + gerekçe + doğrulayıcı kodu (AD11 step-up) + denetim izi; ayar
 * geçmişine `platform_staff` aktörüyle yazılır, proxy en geç 30 sn içinde kısıtsız görür.
 */
export type OfficeSecurityAdminResult = { ok?: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_REASON = 10;

export async function resetOfficeSecurityPolicyByAdmin(formData: FormData): Promise<OfficeSecurityAdminResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "reset_security_policy")) return { error: OFFICE_ADMIN_DENIED };
  const tenantId = String(formData.get("id") ?? "");
  if (!UUID_RE.test(tenantId)) return { error: "Ofis bulunamadı." };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (reason.length < MIN_REASON) return { error: `Gerekçe en az ${MIN_REASON} karakter olmalı.` };
  const { allowed } = await checkRateLimit(`office-security-reset:${staff.id}`, { limit: 10, windowSec: 3600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok sık deneme. Lütfen biraz sonra tekrar deneyin." };

  const stepUp = await requireStepUp(formData, "office_security_reset", staff.id);
  if (!stepUp.ok) return { error: stepUp.error };

  const res = await resetOfficeSecurity({ id: staff.id, tenantId, actorType: "platform_staff" }, `Ofis 360 acil sıfırlama: ${reason}`);
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.security_policy.reset",
    entityType: "tenant",
    entityId: tenantId,
    meta: { reason },
  });
  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true };
}
