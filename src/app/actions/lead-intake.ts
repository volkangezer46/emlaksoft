"use server";

import type { ActionOutcome } from "@/lib/action-outcome";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";

function genToken() {
  return randomUUID().replace(/-/g, "");
}

/** Lead yakalama formunu aç/kapat. */
export async function setLeadCaptureEnabled(formData: FormData): Promise<ActionOutcome> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const enabled = String(formData.get("enabled") ?? "") === "true";

  const supabase = await createClient();
  const { error } = await supabase.from("tenants").update({ lead_capture_enabled: enabled }).eq("id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Ayar kaydedilemedi.") };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "lead.capture.toggle",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { enabled },
  });
  revalidatePath("/app/ayarlar/lead");
  return { ok: true };
}

/** Public lead token'ını yenile (eski bağlantı geçersiz olur). */
export async function regenerateLeadToken(): Promise<ActionOutcome> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { error } = await admin.rpc("rotate_lead_capture_token", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_new_token: genToken(),
    p_reason: "rotated",
  });
  if (error) {
    console.error("regenerateLeadToken", { code: error.code });
    return { error: "Aday bağlantı anahtarı yenilenemedi; mevcut bağlantı çalışmaya devam ediyor. Birkaç dakika sonra yeniden deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "lead.capture.regenerate_token",
    entityType: "tenant",
    entityId: gate.tenantId,
  });
  revalidatePath("/app/ayarlar/lead");
  return { ok: true };
}
