"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import {
  KVKK_CUSTOMER_TYPES,
  KVKK_OFFICE_TYPES,
  isKvkkStatus,
  isKvkkType,
  parseDueDays,
} from "@/lib/compliance/kvkk-requests";

export type KvkkRequestResult = { ok?: boolean; error?: string; message?: string };

const MISSING_TABLE = /kvkk_requests|schema cache|does not exist/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * KVKK talebi kaydeder (veri sahibi talepleri müşteriye bağlanır; ofis hesabı kapatma ve veri indirme
 * ofis düzeyindedir). Yalnız kayıt ve süre takibi: işlem (anonimleştirme vb.) mevcut KVKK panelinde yapılır.
 */
export async function createKvkkRequest(
  _prev: KvkkRequestResult,
  formData: FormData,
): Promise<KvkkRequestResult> {
  const gate = await requirePermission("compliance", "create");
  if (!gate.ok) return { error: gate.error };

  const type = String(formData.get("request_type") ?? "").trim();
  if (!isKvkkType(type)) return { error: "Talep türünü seçin." };
  const dueDays = parseDueDays(formData.get("due_days"));
  if (dueDays === null) return { error: "Yanıt süresi 1 ile 90 gün arasında olmalı." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const requesterName = String(formData.get("requester_name") ?? "").trim().slice(0, 120);
  const customerId = String(formData.get("customer_id") ?? "").trim();

  const isOfficeType = (KVKK_OFFICE_TYPES as readonly string[]).includes(type);
  // Ofis düzeyi talepler yalnız ofis sahibi / genel müdür tarafından açılır.
  if (isOfficeType && !["owner", "gm"].includes(gate.role)) {
    return { error: "Hesap kapatma ve veri indirme talebini yalnız ofis sahibi veya genel müdür açabilir." };
  }
  if ((KVKK_CUSTOMER_TYPES as readonly string[]).includes(type) && !customerId && !requesterName) {
    return { error: "Müşteri seçin veya başvuru sahibinin adını yazın." };
  }
  if (customerId && !UUID_RE.test(customerId)) return { error: "Müşteri bulunamadı." };

  const supabase = await createClient();
  if (customerId) {
    const { data: c } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!c) return { error: "Müşteri bu ofise ait değil." };
  }

  const dueAt = new Date(now() + dueDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("kvkk_requests")
    .insert({
      tenant_id: gate.tenantId,
      request_type: type,
      customer_id: customerId || null,
      requester_name: requesterName || null,
      note: note || null,
      due_at: dueAt,
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createKvkkRequest", error?.message);
    return {
      error: error && MISSING_TABLE.test(error.message)
        ? "KVKK talep kaydı bu ortamda henüz etkin değil."
        : "Talep kaydedilemedi.",
    };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "kvkk.request_created",
    entityType: "kvkk_request",
    entityId: data.id,
    newValue: { request_type: type, due_days: dueDays, customer_id: customerId || null },
  });
  revalidatePath("/app/uyum/talepler");
  return { ok: true, message: "Talep kaydedildi." };
}

/** Talep durumunu günceller (işlemde / tamamlandı / reddedildi + çözüm notu). */
export async function updateKvkkRequestStatus(
  _prev: KvkkRequestResult,
  formData: FormData,
): Promise<KvkkRequestResult> {
  const gate = await requirePermission("compliance", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const resolution = String(formData.get("resolution_note") ?? "").trim().slice(0, 1000);
  if (!UUID_RE.test(id) || !isKvkkStatus(status)) return { error: "Geçersiz istek." };
  if ((status === "completed" || status === "rejected") && !resolution) {
    return { error: "Tamamlama veya ret için kısa bir çözüm notu yazın." };
  }

  const supabase = await createClient();
  const finished = status === "completed" || status === "rejected";
  const { error } = await supabase
    .from("kvkk_requests")
    .update({
      status,
      resolution_note: finished ? resolution : null,
      resolved_by: finished ? gate.userId : null,
      resolved_at: finished ? new Date(now()).toISOString() : null,
      updated_at: new Date(now()).toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("updateKvkkRequestStatus", error.message);
    return { error: "Talep güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "kvkk.request_status",
    entityType: "kvkk_request",
    entityId: id,
    newValue: { status },
  });
  revalidatePath("/app/uyum/talepler");
  return { ok: true, message: "Talep güncellendi." };
}
