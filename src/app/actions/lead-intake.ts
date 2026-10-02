"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

function genToken() {
  return randomUUID().replace(/-/g, "");
}

/** Lead yakalama formunu aç/kapat. */
export async function setLeadCaptureEnabled(formData: FormData): Promise<void> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return;
  const enabled = String(formData.get("enabled") ?? "") === "true";

  const supabase = await createClient();
  await supabase.from("tenants").update({ lead_capture_enabled: enabled }).eq("id", gate.tenantId);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "lead.capture.toggle",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { enabled },
  });
  revalidatePath("/app/ayarlar/lead");
}

/** Public lead token'ını yenile (eski bağlantı geçersiz olur). */
export async function regenerateLeadToken(): Promise<void> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return;

  const admin = createAdminClient();
  const { error } = await admin.rpc("rotate_lead_capture_token", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_new_token: genToken(),
    p_reason: "rotated",
  });
  if (error) {
    console.error("regenerateLeadToken", { code: error.code });
    throw new Error("Lead bağlantı anahtarı yenilenemedi.");
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "lead.capture.regenerate_token",
    entityType: "tenant",
    entityId: gate.tenantId,
  });
  revalidatePath("/app/ayarlar/lead");
}
