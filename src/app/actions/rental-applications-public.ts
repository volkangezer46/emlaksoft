"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { now, trDayKey } from "@/lib/clock";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { actionErrorMessage } from "@/lib/action-errors";
import { verifyDocumentFile } from "@/lib/file-validation";
import {
  DIRECT_FILE_UPLOAD_CONFIG,
  buildDirectFileUploadPath,
  isUuid,
  validateDirectFileUploadMetadata,
  type DirectFileUploadPrepareResult,
} from "@/lib/direct-file-uploads";
import {
  APPLICATION_MAX_FILES,
  APPLICATION_UPLOAD_KEY_TTL_MS,
  TOKEN_RE,
  isApplicationDocType,
  parseApplicationForm,
} from "@/lib/rentals/applications";
import { generateApplicationToken, hashUploadKey, resolveApplicationLink } from "@/lib/rentals/application-link.server";

/**
 * Kiracı başvurusu PUBLIC akışları (oturum YOK): /kiraci-basvuru/<token> formu, evrak yükleme ve malik portalı kararı.
 * Tablolar anon/authenticated'a kapalı; yazma service_role ile, tenant/portföy her zaman token'ın çözdüğü kayda sabit.
 * Her uç IP (+ token) hız sınırlıdır ve altyapı hatasında KAPALI kalır (failurePolicy deny).
 */

const BUCKET = "customer-files";
const BUSY = "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.";
const INVALID = "Bağlantı geçersiz veya başvuruya kapalı.";
const PENDING_WINDOW_MS = 30 * 60 * 1000;

export type ApplicationSubmitResult = { ok?: boolean; error?: string; applicationId?: string; uploadKey?: string; duplicate?: boolean };
export type ApplicationUploadFinalizeResult = { ok?: boolean; error?: string; fileCount?: number };
export type OwnerApplicantDecisionResult = { ok: boolean; message: string };

async function limited(kind: string, scope: string, ipLimit: number, scopeLimit: number): Promise<boolean> {
  const ip = await clientIp();
  const [byIp, byScope] = await Promise.all([
    checkRateLimit(`rental-app:${kind}:ip:${ip}`, { limit: ipLimit, windowSec: 10 * 60, failurePolicy: "deny" }),
    checkRateLimit(`rental-app:${kind}:scope:${scope}`, { limit: scopeLimit, windowSec: 10 * 60, failurePolicy: "deny" }),
  ]);
  return !byIp.allowed || !byScope.allowed;
}

/** Aday formu gönderimi. Başarıda evrak yüklemek için 2 saatlik tek başvuruya bağlı anahtar döner (düz saklanmaz). */
export async function submitRentalApplication(fd: FormData): Promise<ApplicationSubmitResult> {
  // Honeypot: bot gizli alanı doldurursa sessizce "başarılı" (kayıt yok).
  if (String(fd.get("website") ?? "").trim()) return { ok: true };
  const token = String(fd.get("token") ?? "").trim();
  if (!TOKEN_RE.test(token)) return { error: INVALID };
  if (await limited("submit", token.slice(0, 16), 6, 40)) return { error: BUSY };
  if (String(fd.get("kvkk") ?? "") !== "on") return { error: "Devam etmek için aydınlatma metnini onaylayın." };

  const lookup = await resolveApplicationLink(token);
  if (!lookup.ok || lookup.state !== "open") return { error: INVALID };

  const parsed = parseApplicationForm(fd, trDayKey(now()));
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;
  const phone = parsePhoneStrict(v.phoneRaw);
  if (!phone.ok) return { error: phone.error ?? PHONE_ERROR_MESSAGE };
  let guarantorPhone: string | null = null;
  if (v.guarantorPhoneRaw) {
    const g = parsePhoneStrict(v.guarantorPhoneRaw);
    if (!g.ok) return { error: `Kefil telefonu: ${g.error ?? PHONE_ERROR_MESSAGE}` };
    guarantorPhone = g.stored;
  }
  const email = v.email ? normalizeEmail(v.email) : null;
  if (email && !isValidEmail(email)) return { error: "Geçerli bir e-posta adresi yazın ya da alanı boş bırakın." };

  const uploadKey = generateApplicationToken();
  const nowIso = new Date(now()).toISOString();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_applications")
    .insert({
      tenant_id: lookup.link.tenant_id,
      link_id: lookup.link.id,
      property_id: lookup.link.property_id,
      full_name: v.fullName,
      phone: phone.stored,
      email,
      occupation: v.occupation,
      employer: v.employer,
      monthly_income: v.monthlyIncome,
      household_size: v.householdSize,
      has_pets: v.hasPets,
      pets_note: v.petsNote,
      smoker: v.smoker,
      move_in_date: v.moveInDate,
      message: v.message,
      guarantor_name: v.guarantorName,
      guarantor_phone: v.guarantorName ? guarantorPhone : null,
      guarantor_relation: v.guarantorRelation,
      guarantor_occupation: v.guarantorOccupation,
      guarantor_income: v.guarantorIncome,
      guarantor_address: v.guarantorAddress,
      kvkk_consent_at: nowIso,
      upload_key_hash: hashUploadKey(uploadKey),
      upload_key_expires_at: new Date(now() + APPLICATION_UPLOAD_KEY_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: true, duplicate: true };
    }
    console.error("submitRentalApplication insert", { code: error?.code });
    return { error: actionErrorMessage(error, "Başvurunuz kaydedilemedi. Lütfen tekrar deneyin.") };
  }

  const { count } = await admin
    .from("rental_applications")
    .select("id", { count: "exact", head: true })
    .eq("link_id", lookup.link.id)
    .eq("tenant_id", lookup.link.tenant_id);
  await admin
    .from("rental_application_links")
    .update({ application_count: count ?? 0 })
    .eq("id", lookup.link.id)
    .eq("tenant_id", lookup.link.tenant_id);

  const propLabel = lookup.property.title ?? lookup.property.code ?? "Kiralık portföy";
  try {
    await notifyTenant({
      tenantId: lookup.link.tenant_id,
      userId: lookup.property.assignedTo,
      title: `Yeni kiracı başvurusu: ${v.fullName}`,
      body: `${propLabel} için başvuru geldi. Adayları yan yana karşılaştırabilirsiniz.`,
      href: `/app/kiralama/basvurular/${data.id}`,
      kind: "success",
      prefKey: "portal",
      tel: phone.stored,
    });
  } catch (e) {
    console.error("submitRentalApplication notify", e instanceof Error ? e.message : "unknown");
  }
  await logActivity({
    tenantId: lookup.link.tenant_id,
    actorId: null,
    action: "rental_application.submitted",
    entityType: "rental_application",
    entityId: data.id,
    newValue: { property_id: lookup.link.property_id, has_guarantor: Boolean(v.guarantorName) },
  });
  return { ok: true, applicationId: data.id, uploadKey };
}

type UploadContext = { tenantId: string; applicationId: string; fileCount: number };

/** Bağlantı + yükleme anahtarı birlikte doğrulanır; anahtar süresi dolmuşsa yükleme kapanır. */
async function uploadContext(token: string, applicationId: string, uploadKey: string): Promise<UploadContext | { error: string }> {
  if (!TOKEN_RE.test(token) || !isUuid(applicationId) || !TOKEN_RE.test(uploadKey)) return { error: INVALID };
  const lookup = await resolveApplicationLink(token);
  if (!lookup.ok) return { error: INVALID };
  const admin = createAdminClient();
  const { data: app } = await admin
    .from("rental_applications")
    .select("id, tenant_id, link_id, file_count, upload_key_hash, upload_key_expires_at, status")
    .eq("id", applicationId)
    .eq("tenant_id", lookup.link.tenant_id)
    .eq("link_id", lookup.link.id)
    .maybeSingle();
  if (!app || !app.upload_key_hash || app.upload_key_hash !== hashUploadKey(uploadKey)) return { error: INVALID };
  if (!app.upload_key_expires_at || Date.parse(app.upload_key_expires_at) <= now()) {
    return { error: "Evrak yükleme süresi doldu. Evraklarınızı ofisinize iletebilirsiniz." };
  }
  if (app.status === "withdrawn" || app.status === "rejected") return { error: "Bu başvuru kapandı." };
  return { tenantId: app.tenant_id, applicationId: app.id, fileCount: app.file_count ?? 0 };
}

export async function prepareApplicationUpload(
  token: string,
  applicationId: string,
  uploadKey: string,
  input: { fileName: string; fileSize: number; fileType: string; docType: string },
): Promise<DirectFileUploadPrepareResult> {
  if (await limited("prepare", String(applicationId).slice(0, 36), 60, 30)) return { error: BUSY };
  const ctx = await uploadContext(token, applicationId, uploadKey);
  if ("error" in ctx) return { error: ctx.error };
  const docType = String(input?.docType ?? "");
  if (!isApplicationDocType(docType)) return { error: "Bu evrak türü kabul edilmiyor." };
  const meta = validateDirectFileUploadMetadata("customer_file", {
    parentId: ctx.applicationId,
    fileName: input?.fileName,
    fileSize: input?.fileSize,
    fileType: input?.fileType,
    label: null,
  });
  if (!meta.ok) return { error: meta.error };
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(meta.value.claimedMime)) {
    return { error: "JPG, PNG, WEBP fotoğraf ya da PDF yükleyin." };
  }

  const admin = createAdminClient();
  const sinceIso = new Date(now() - PENDING_WINDOW_MS).toISOString();
  const [{ count: verified }, { count: pending }] = await Promise.all([
    admin.from("rental_application_files").select("id", { count: "exact", head: true })
      .eq("application_id", ctx.applicationId).eq("tenant_id", ctx.tenantId).eq("status", "verified"),
    admin.from("rental_application_files").select("id", { count: "exact", head: true })
      .eq("application_id", ctx.applicationId).eq("tenant_id", ctx.tenantId).eq("status", "pending").gte("created_at", sinceIso),
  ]);
  if ((verified ?? 0) + (pending ?? 0) >= APPLICATION_MAX_FILES) return { error: `En çok ${APPLICATION_MAX_FILES} dosya yükleyebilirsiniz.` };

  const fileId = crypto.randomUUID();
  const path = buildDirectFileUploadPath(ctx.tenantId, ctx.applicationId, fileId, meta.value.canonicalExtension);
  const { error: insertError } = await admin.from("rental_application_files").insert({
    id: fileId,
    tenant_id: ctx.tenantId,
    application_id: ctx.applicationId,
    doc_type: docType,
    storage_path: path,
    file_name: meta.value.fileName,
    file_size: meta.value.fileSize,
    mime_type: meta.value.claimedMime,
    status: "pending",
  });
  if (insertError) {
    console.error("prepareApplicationUpload insert", { code: insertError.code });
    return { error: actionErrorMessage(insertError, "Yükleme oturumu oluşturulamadı; birkaç saniye sonra fotoğrafı yeniden seçin.") };
  }
  const { data: signed, error: signError } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (signError || !signed?.token || signed.path !== path) {
    await admin.from("rental_application_files").update({ status: "blocked" }).eq("id", fileId).eq("status", "pending");
    return { error: "Güvenli yükleme bağlantısı oluşturulamadı; birkaç saniye sonra dosyayı yeniden seçin." };
  }
  return {
    ok: true,
    upload: {
      sessionId: fileId,
      bucket: BUCKET,
      path,
      token: signed.token,
      contentType: meta.value.claimedMime,
      finalizeBy: new Date(now() + 15 * 60 * 1000).toISOString(),
    },
  };
}

/** Yüklenen nesneyi bayt düzeyinde doğrular; geçemezse siler ve engeller. */
export async function finalizeApplicationUpload(
  token: string,
  applicationId: string,
  uploadKey: string,
  fileId: string,
): Promise<ApplicationUploadFinalizeResult> {
  if (!isUuid(fileId)) return { error: "Yükleme oturumu geçersiz." };
  if (await limited("finalize", String(applicationId).slice(0, 36), 60, 30)) return { error: BUSY };
  const ctx = await uploadContext(token, applicationId, uploadKey);
  if ("error" in ctx) return { error: ctx.error };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("rental_application_files")
    .select("id, storage_path, file_name, file_size, mime_type, status")
    .eq("id", fileId)
    .eq("application_id", ctx.applicationId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!row) return { error: "Yükleme oturumu bulunamadı." };
  if (row.status === "verified") return { ok: true, fileCount: ctx.fileCount };
  if (row.status !== "pending") return { error: "Dosya güvenlik doğrulamasından geçemedi." };

  const storage = admin.storage.from(BUCKET);
  const block = async () => {
    await admin.from("rental_application_files").update({ status: "blocked" }).eq("id", row.id);
    await storage.remove([row.storage_path]);
  };
  const { data: blob, error: downloadError } = await storage.download(row.storage_path);
  if (downloadError || !blob) return { error: "Yüklenen dosya henüz bulunamadı. Lütfen tekrar deneyin." };
  const config = DIRECT_FILE_UPLOAD_CONFIG.customer_file;
  if (blob.size <= 0 || blob.size > config.maxBytes || blob.size !== Number(row.file_size)) {
    await block();
    return { error: "Yüklenen dosyanın boyutu beklenen değerle eşleşmiyor." };
  }
  const verified = await verifyDocumentFile(new File([blob], row.file_name, { type: row.mime_type }), config.allowedMime);
  if (!verified.ok || verified.type !== row.mime_type) {
    await block();
    return { error: verified.ok ? "Dosya içeriği ile bildirilen tür uyuşmuyor." : verified.error };
  }
  const { error: updateError } = await admin
    .from("rental_application_files")
    .update({ status: "verified", verified_at: new Date(now()).toISOString() })
    .eq("id", row.id)
    .eq("status", "pending");
  if (updateError) return { error: "Dosya doğrulandı ancak kaydedilemedi. Lütfen yeniden deneyin." };

  const { count } = await admin
    .from("rental_application_files")
    .select("id", { count: "exact", head: true })
    .eq("application_id", ctx.applicationId)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "verified");
  const fileCount = Math.min(count ?? ctx.fileCount + 1, 30);
  await admin.from("rental_applications").update({ file_count: fileCount }).eq("id", ctx.applicationId).eq("tenant_id", ctx.tenantId);
  return { ok: true, fileCount };
}

const OWNER_TOKEN_RE = /^[0-9a-f]{32,128}$/;

/**
 * Malik portalı: önerilen kiracı adayına onay/ret. Token malikin portföyüne sabit; yalnız o portföyün "malik onayında"
 * durumundaki başvurusu karar alır (KVKK: başka portföy/aday görünmez, karar verilemez).
 */
export async function decideApplicantByOwner(fd: FormData): Promise<OwnerApplicantDecisionResult> {
  const token = String(fd.get("token") ?? "").trim();
  const applicationId = String(fd.get("application_id") ?? "").trim();
  const decision = String(fd.get("decision") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);
  if (!OWNER_TOKEN_RE.test(token) || !isUuid(applicationId) || (decision !== "approved" && decision !== "rejected")) {
    return { ok: false, message: "Geçersiz istek." };
  }
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`owner-applicant:${ip}`, { limit: 10, windowSec: 60, failurePolicy: "deny" });
  if (!allowed) return { ok: false, message: BUSY };

  const admin = createAdminClient();
  const { data: portal } = await admin
    .from("owner_portal_tokens")
    .select("tenant_id, property_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!portal || Date.parse(portal.expires_at) <= now()) return { ok: false, message: "Bağlantının süresi dolmuş. Ofisinizden yeni bağlantı isteyin." };
  const { data: tenant } = await admin.from("tenants").select("status").eq("id", portal.tenant_id).maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) return { ok: false, message: "Bağlantı geçersiz." };

  const nowIso = new Date(now()).toISOString();
  const { data: updated, error } = await admin
    .from("rental_applications")
    .update({
      status: decision,
      status_changed_at: nowIso,
      owner_decision: decision,
      owner_note: note || null,
      owner_decided_at: nowIso,
      updated_at: nowIso,
      ...(decision === "approved" ? { retain_until: new Date(now() + 730 * 86_400_000).toISOString() } : {}),
    })
    .eq("id", applicationId)
    .eq("tenant_id", portal.tenant_id)
    .eq("property_id", portal.property_id)
    .eq("status", "owner_review")
    .select("id, full_name")
    .maybeSingle();
  if (error) {
    console.error("decideApplicantByOwner", { code: error.code });
    return { ok: false, message: "Kararınız kaydedilemedi; sayfayı yenileyip yeniden deneyin ya da danışmanınızı arayın." };
  }
  if (!updated) return { ok: false, message: "Bu aday için karar zaten verilmiş ya da öneri geri alınmış." };

  try {
    await notifyTenant({
      tenantId: portal.tenant_id,
      title: decision === "approved" ? `Malik kiracı adayını onayladı: ${updated.full_name}` : `Malik kiracı adayını reddetti: ${updated.full_name}`,
      body: note ? `Malik notu: ${note}` : undefined,
      href: `/app/kiralama/basvurular/${updated.id}`,
      kind: decision === "approved" ? "success" : "warning",
      prefKey: "portal",
    });
  } catch (e) {
    console.error("decideApplicantByOwner notify", e instanceof Error ? e.message : "unknown");
  }
  await logActivity({
    tenantId: portal.tenant_id,
    actorId: null,
    action: "rental_application.owner_decision",
    entityType: "rental_application",
    entityId: updated.id,
    newValue: { decision, has_note: Boolean(note) },
  });
  revalidatePath(`/malik-portali/${token}`);
  return {
    ok: true,
    message: decision === "approved" ? "Teşekkürler, adayı onayladınız. Danışmanınız sözleşme için sizinle iletişime geçecek." : "Adayı reddettiniz. Danışmanınız yeni adaylarla dönecek.",
  };
}
