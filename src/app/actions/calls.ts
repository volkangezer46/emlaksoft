"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isValidTurkishMobile, normalizeTurkishPhone, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";

export type CallResult = { error?: string; ok?: boolean };

export async function createCall(formData: FormData): Promise<CallResult> {
  const gate = await requirePermission("calls", "create");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const direction = String(formData.get("direction") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const disposition = String(formData.get("disposition") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const duration = Number(formData.get("duration_sec") ?? 0);

  if (!rawPhone || !["inbound", "outbound", "missed"].includes(direction)) {
    return { error: "Telefon ve çağrı yönü zorunlu." };
  }
  if (!isValidTurkishMobile(rawPhone)) return { error: TR_MOBILE_ERROR_MESSAGE };
  const phone = normalizeTurkishPhone(rawPhone);
  if (direction !== "missed" && !disposition) {
    return { error: "Görüşme sonuç kodu zorunlu." };
  }

  const startedAt = new Date();
  const durationSec = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
  const endedAt = durationSec ? new Date(startedAt.getTime() + durationSec * 1000).toISOString() : null;

  const supabase = await createClient();
  const { error } = await supabase.from("calls").insert({
    tenant_id: gate.tenantId,
    customer_id: customerId || null,
    direction,
    phone,
    duration_sec: durationSec,
    disposition: disposition || null,
    notes: notes || null,
    handled_by: gate.userId,
    started_at: startedAt.toISOString(),
    ended_at: endedAt,
  });

  if (error) {
    console.error("createCall", error);
    return { error: "Çağrı kaydı oluşturulamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "call.create",
    entityType: "call",
    entityId: customerId || undefined,
    newValue: { direction, phone, disposition },
  });

  revalidatePath("/app/arama");
  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath("/app");
  return { ok: true };
}
