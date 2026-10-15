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
import { actionErrorMessage } from "@/lib/action-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildSubjectExport,
  loadSubjectData,
  subjectExportHash,
} from "@/lib/compliance/subject-export";

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
        : actionErrorMessage(null, "Talep kaydedilemedi."),
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
    return { error: actionErrorMessage(error, "Talep güncellenemedi.") };
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

const EXPORT_MISSING_TABLE = /kvkk_subject_exports|schema cache|does not exist/i;

/**
 * Araştırma 7: veri sahibi dökümü — talebe bağlı müşterinin tüm kişisel verisi (kişi kartı, talepler, randevular,
 * iletişim/mesajlar, çağrılar, teklifler, İYS izinleri + geçmişi, belge listesi, KVKK başvuruları, işlem kaydı)
 * tek tıkla JSON anlık görüntüsüne alınır, SHA-256 ile mühürlenir, talebe eklenir ve işlem kaydına düşer.
 * Açık talep "işlemde"ye alınır. Yazdırılabilir görünüm ve JSON indirme `/app/uyum/talepler/[id]/dokum`.
 */
export async function generateKvkkSubjectExport(
  _prev: KvkkRequestResult,
  formData: FormData,
): Promise<KvkkRequestResult> {
  const gate = await requirePermission("compliance", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Geçersiz istek." };

  const supabase = await createClient();
  const [{ data: request, error: requestError }, { data: office }] = await Promise.all([
    supabase
      .from("kvkk_requests")
      .select("id, request_type, status, customer_id, created_at, due_at")
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
    supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle(),
  ]);
  if (requestError || !request) return { error: "Talep bulunamadı." };
  if (!request.customer_id) {
    return { error: "Döküm için talebin bir müşteriye bağlı olması gerekir. Başvuru sahibini müşteri olarak seçip yeni talep açın." };
  }

  const admin = createAdminClient();
  const raw = await loadSubjectData(supabase, admin, gate.tenantId, request.customer_id);
  if (!raw.customer) return { error: "Talebe bağlı müşteri kaydına erişilemedi." };

  const doc = buildSubjectExport(raw, {
    requestId: request.id,
    requestType: request.request_type,
    requestCreatedAt: request.created_at ?? null,
    dueAt: request.due_at ?? null,
    officeName: (office as { name?: string | null } | null)?.name ?? null,
    generatedAt: new Date(now()).toISOString(),
  });
  const sha = subjectExportHash(doc);

  // Saklama: ofisin süresi dolmuş dökümleri silinir (kişisel veri gereğinden uzun tutulmaz).
  await admin.from("kvkk_subject_exports").delete().eq("tenant_id", gate.tenantId).lt("expires_at", new Date(now()).toISOString());
  const { data: saved, error: saveError } = await admin
    .from("kvkk_subject_exports")
    .insert({
      tenant_id: gate.tenantId,
      request_id: request.id,
      customer_id: request.customer_id,
      generated_by: gate.userId,
      payload: doc,
      payload_sha256: sha,
      item_counts: doc.counts,
    })
    .select("id")
    .single();
  if (saveError || !saved) {
    console.error("generateKvkkSubjectExport", saveError?.message);
    return {
      error: saveError && EXPORT_MISSING_TABLE.test(saveError.message)
        ? "Veri dökümü bu ortamda henüz etkin değil."
        : actionErrorMessage(saveError, "Döküm kaydedilemedi."),
    };
  }

  if (request.status === "open") {
    await supabase
      .from("kvkk_requests")
      .update({ status: "in_progress", updated_at: new Date(now()).toISOString() })
      .eq("id", request.id)
      .eq("tenant_id", gate.tenantId);
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "kvkk.subject_export_generated",
    entityType: "kvkk_request",
    entityId: request.id,
    newValue: { export_id: saved.id, customer_id: request.customer_id, sha256: sha, counts: doc.counts },
  });
  revalidatePath("/app/uyum/talepler");
  return { ok: true, message: "Veri dökümü hazırlandı ve talebe eklendi." };
}
