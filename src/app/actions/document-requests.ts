"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { getBaseUrl } from "@/lib/base-url";
import { daysFromNowIso } from "@/lib/clock";
import { extractPropertyDocFields, isDocOcrConfigured, type PropertyDocFields } from "@/lib/ai/document-ocr";
import { isOcrEligible, parseCreateRequestForm } from "@/lib/doc-request/doc-request";
import { DOC_REQUEST_BUCKET, generateRequestToken, hashRequestToken } from "@/lib/doc-request/server";

export type DocRequestResult = { ok?: boolean; error?: string; message?: string; url?: string };
export type DocRequestFileUrlResult = { error?: string; url?: string };
export type DocRequestOcrResult = {
  error?: string;
  /** OCR yapılandırılmamış: panel "etkin değil" gösterir. */
  disabled?: boolean;
  fields?: PropertyDocFields;
  guven?: "yüksek" | "orta" | "düşük";
  note?: string | null;
  propertyId?: string | null;
};

const MISSING_TABLE = /document_requests|document_request_files|schema cache|does not exist/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Evrak linki üretir. Link YALNIZ bu cevapta döner (ham token saklanmaz); SMS GÖNDERİLMEZ,
 * danışman paneldeki kopyala düğmesiyle paylaşır. Kaybolursa iptal edip yenisi üretilir.
 */
export async function createDocumentRequest(
  _prev: DocRequestResult,
  formData: FormData,
): Promise<DocRequestResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  const parsed = parseCreateRequestForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  const supabase = await createClient();
  let isSample = false;
  if (v.customerId) {
    const { data: c } = await supabase
      .from("customers")
      .select("id, is_sample")
      .eq("id", v.customerId)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!c) return { error: "Müşteri bu ofise ait değil veya artık aktif değil." };
    isSample = isSample || c.is_sample === true;
  }
  if (v.propertyId) {
    const { data: p } = await supabase
      .from("properties")
      .select("id, is_sample")
      .eq("id", v.propertyId)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!p) return { error: "Portföy bu ofise ait değil veya artık aktif değil." };
    isSample = isSample || p.is_sample === true;
  }

  const token = generateRequestToken();
  const { data, error } = await supabase
    .from("document_requests")
    .insert({
      tenant_id: gate.tenantId,
      customer_id: v.customerId,
      property_id: v.propertyId,
      title: v.title,
      requested_types: v.types,
      token_hash: hashRequestToken(token),
      max_files: v.maxFiles,
      expires_at: daysFromNowIso(v.expiryDays),
      is_sample: isSample,
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createDocumentRequest", error?.message);
    return {
      error: error && MISSING_TABLE.test(error.message)
        ? "Evrak linki bu ortamda henüz etkin değil."
        : "Evrak linki oluşturulamadı.",
    };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "document_request.created",
    entityType: "document_request",
    entityId: data.id,
    newValue: { types: v.types, expiry_days: v.expiryDays, max_files: v.maxFiles, sample: isSample },
  });
  revalidatePath("/app/belgeler/evrak-linkleri");
  return {
    ok: true,
    url: `${getBaseUrl()}/evrak/${token}`,
    message: isSample
      ? "Örnek veriye bağlı link üretildi; herkese açık sayfada çalışmaz."
      : "Link hazır. Kopyalayıp müşteriye kendiniz iletin; bu link yeniden gösterilmez.",
  };
}

/** Linki iptal eder: yükleme yolu hemen kapanır, yüklenmiş dosyalar silinmez. */
export async function revokeDocumentRequest(id: string): Promise<DocRequestResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(id ?? ""))) return { error: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_requests")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("revokeDocumentRequest", error.message);
    return { error: "Link iptal edilemedi." };
  }
  if (!data) return { error: "Link bulunamadı veya zaten kapalı." };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "document_request.revoked",
    entityType: "document_request",
    entityId: id,
  });
  revalidatePath("/app/belgeler/evrak-linkleri");
  return { ok: true, message: "Link iptal edildi." };
}

async function loadOwnedFile(fileId: string, tenantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("document_request_files")
    .select("id, request_id, doc_type, storage_path, file_name, mime_type, status, request:document_requests!document_request_files_request_id_fkey(property_id)")
    .eq("id", fileId)
    .eq("tenant_id", tenantId)
    .eq("status", "verified")
    .maybeSingle();
  if (!data) return null;
  const req = Array.isArray(data.request) ? data.request[0] : data.request;
  return { ...data, property_id: (req?.property_id as string | null | undefined) ?? null };
}

/** Yüklenen dosya için 60 sn geçerli, indirme başlıklı imzalı bağlantı; yalnız aynı ofisin personeli. */
export async function getDocumentRequestFileUrl(fileId: string): Promise<DocRequestFileUrlResult> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(fileId ?? ""))) return { error: "Dosya bulunamadı." };
  const file = await loadOwnedFile(fileId, gate.tenantId);
  if (!file) return { error: "Dosya bulunamadı." };
  if (!file.storage_path.startsWith(`${gate.tenantId}/${file.request_id}/`) || file.storage_path.includes("..")) {
    return { error: "Dosya yolu güvenlik doğrulamasından geçemedi." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(DOC_REQUEST_BUCKET).createSignedUrl(file.storage_path, 60, {
    download: file.file_name,
  });
  if (error || !data?.signedUrl) return { error: "Dosya bağlantısı oluşturulamadı." };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "document_request.download",
    entityType: "document_request",
    entityId: file.request_id,
    newValue: { file_id: file.id },
  });
  return { url: data.signedUrl };
}

/**
 * Tapu / yetki görselinden alan ÖNERİSİ. Hiçbir şey kaydedilmez: sonuç panelde düzenlenir ve
 * yalnız kullanıcı onaylarsa mevcut `applyDocFieldsToProperty` ile portföye yazılır.
 * Kimlik belgeleri ve PDF'ler OCR'a gönderilmez. AI anahtarı yoksa özellik "etkin değil" döner.
 */
export async function suggestDocumentFields(fileId: string): Promise<DocRequestOcrResult> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { error: gate.error };
  if (!isDocOcrConfigured()) return { disabled: true, error: "Belge okuma (OCR) bu ortamda etkin değil." };
  if (!UUID_RE.test(String(fileId ?? ""))) return { error: "Dosya bulunamadı." };
  const file = await loadOwnedFile(fileId, gate.tenantId);
  if (!file) return { error: "Dosya bulunamadı." };
  if (!isOcrEligible(file.doc_type, file.mime_type)) {
    return { error: "Belge okuma yalnız görsel (JPG, PNG, WEBP) tapu veya yetki belgelerinde kullanılır." };
  }
  if (!file.storage_path.startsWith(`${gate.tenantId}/${file.request_id}/`) || file.storage_path.includes("..")) {
    return { error: "Dosya yolu güvenlik doğrulamasından geçemedi." };
  }
  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from(DOC_REQUEST_BUCKET).download(file.storage_path);
  if (error || !blob) return { error: "Dosya okunamadı." };
  const result = await extractPropertyDocFields(
    { imageBase64: Buffer.from(await blob.arrayBuffer()).toString("base64"), mimeType: file.mime_type },
    { tenantId: gate.tenantId, actorId: gate.userId },
  );
  if (!result.ok) return { error: result.error };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "document_request.ocr_suggest",
    entityType: "document_request",
    entityId: file.request_id,
    newValue: { file_id: file.id, guven: result.extraction.guven },
  });
  return {
    fields: result.extraction.fields,
    guven: result.extraction.guven,
    note: result.extraction.not,
    propertyId: file.property_id,
  };
}
