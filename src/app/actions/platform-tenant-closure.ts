"use server";

import { revalidatePath } from "next/cache";
import { setTenantLifecycleByAdmin } from "@/app/actions/platform-tenants";
import { logActivity } from "@/lib/activity";
import { OFFICE_ADMIN_DENIED, officeAdminCan } from "@/lib/admin/office-admin-access";
import { confirmationMatches } from "@/lib/admin/office-create-rules";
import { isClosureRequestType, planClosure } from "@/lib/admin/office-closure";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export type ClosureResult = { ok?: boolean; error?: string; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ofis sahibinin açtığı "hesabı kapat" / "veriyi indir" talebini işler (yalnız süper admin).
 * Hesap kapatma = ofisi ARŞİVLEMEK (tenants.status = cancelled): hiçbir veri silinmez, geri yüklenebilir.
 * Sıra: (1) ofis arşivlenir (mevcut setTenantLifecycleByAdmin: ofis adı onayı + gerekçe + denetim kaydı),
 * (2) talep "tamamlandı"ya çekilir, (3) platform + ofis denetim kaydı. Arşiv başarılı olup talep güncellemesi
 * başarısız olursa aynı işlem tekrarlanabilir (arşivdeki ofis yeniden arşivlenmez).
 * Veri paketi: ofis sahibi arşiv sonrası /app/askida sayfasından kendi verisini indirir; platform müşteri
 * verisini okumaz. Ayrıca "ayrılış kasası" (JSON) indirmesi ayrı yetkiyle mevcuttur.
 */
export async function processOfficeClosureRequestByAdmin(formData: FormData): Promise<ClosureResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "archive")) return { error: OFFICE_ADMIN_DENIED };

  const requestId = String(formData.get("request_id") ?? "").trim();
  const tenantId = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!UUID_RE.test(requestId) || !UUID_RE.test(tenantId)) return { error: "Geçersiz istek." };
  if (reason.length < 5) return { error: "Gerekçe yazın (en az 5 karakter)." };

  const { allowed } = await checkRateLimit(`platform-office:closure:${staff.id}`, {
    limit: 10,
    windowSec: 600,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla işlem yapıldı. Lütfen bir süre sonra tekrar deneyin." };

  const admin = createAdminClient();
  const [{ data: tenant }, { data: request, error: requestError }] = await Promise.all([
    admin.from("tenants").select("id, name, status").eq("id", tenantId).maybeSingle(),
    admin
      .from("kvkk_requests")
      .select("id, tenant_id, request_type, status")
      .eq("id", requestId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  if (!tenant) return { error: "Ofis bulunamadı." };
  if (requestError) return { error: "Talep kaydı bu ortamda henüz etkin değil." };
  if (!request) return { error: "Talep bu ofise ait değil." };
  if (!isClosureRequestType(request.request_type)) return { error: "Bu talep türü bu ekrandan işlenmez." };
  if (request.status !== "open" && request.status !== "in_progress") {
    return { error: "Talep zaten sonuçlandırılmış." };
  }
  if (!confirmationMatches(String(formData.get("confirm_name") ?? ""), String(tenant.name))) {
    return { error: "Onay için ofis adını aynen yazın." };
  }

  const plan = planClosure(request.request_type, String(tenant.status), reason);

  if (plan.archive) {
    const archiveForm = new FormData();
    archiveForm.set("mode", "archive");
    archiveForm.set("id", tenantId);
    archiveForm.set("reason", reason);
    archiveForm.set("confirm_name", String(tenant.name));
    const archived = await setTenantLifecycleByAdmin(archiveForm);
    if (!archived.ok) return { error: archived.error ?? "Ofis arşivlenemedi." };
  }

  const stamp = new Date(now()).toISOString();
  const { error: updateError } = await admin
    .from("kvkk_requests")
    .update({
      status: "completed",
      resolution_note: plan.resolution,
      resolved_at: stamp,
      updated_at: stamp,
    })
    .eq("id", requestId)
    .eq("tenant_id", tenantId)
    .in("status", ["open", "in_progress"]);
  if (updateError) {
    console.error("processOfficeClosureRequestByAdmin", updateError.message);
    return {
      error: plan.archive
        ? "Ofis arşivlendi ancak talep güncellenemedi. Aynı işlemi tekrarlayın."
        : "Talep güncellenemedi.",
    };
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.closure_request_processed",
    entityType: "tenant",
    entityId: tenantId,
    meta: { request_id: requestId, request_type: request.request_type, archived: plan.archive, reason },
  });
  await logActivity({
    tenantId,
    actorId: staff.id,
    action: "kvkk.request_status",
    entityType: "kvkk_request",
    entityId: requestId,
    newValue: { status: "completed", by: "platform" },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/app/uyum/talepler");
  return {
    ok: true,
    message:
      request.request_type === "account_closure"
        ? "Ofis arşivlendi (veri silinmedi) ve talep tamamlandı. Ofis sahibi veri paketini Askıda sayfasından indirebilir."
        : "Veri indirme talebi tamamlandı olarak işaretlendi.",
  };
}
