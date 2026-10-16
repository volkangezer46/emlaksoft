"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { parseMoneyInput } from "@/lib/money-input";
import { isIsoDate } from "@/lib/workflow-state";
import { verifyDocumentFile } from "@/lib/file-validation";
import {
  DIRECT_FILE_UPLOAD_CONFIG,
  buildDirectFileUploadPath,
  isUuid,
  validateDirectFileUploadMetadata,
  type DirectFileUploadPrepareResult,
} from "@/lib/direct-file-uploads";
import {
  INSPECTION_KINDS,
  KIND_SLUGS,
  buildInspectionBody,
  inspectionTitle,
  isItemKey,
  normalizeKeys,
  normalizeMeters,
  normalizeRooms,
  type InspectionKind,
} from "@/lib/rentals/inspection";

/**
 * Teslim / tahliye tutanağı + kalemli depozito kesintisi (SP6). Tutanak ve kesinti oturumlu istemciyle (RLS rentals:edit);
 * fotoğraf meta satırı ve imzalı yükleme/okuma URL'si service_role ile (tablo authenticated'a salt okunur), satır her zaman
 * tenant + tutanak kapısından sonra yazılır. İmza: tutanaktan sözleşme taslağı üretilir, mevcut SMS OTP imza akışıyla gönderilir.
 */

export type InspectionResult = { ok?: boolean; error?: string; id?: string };
export type PhotoFinalizeResult = { ok?: boolean; error?: string; id?: string; url?: string };

const BUCKET = "customer-files";
const MISSING = "Teslim/tahliye tutanağı için veritabanı güncellemesi henüz uygulanmamış.";
const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTOS_PER_INSPECTION = 120;
const isMissing = (e: { code?: string } | null | undefined) => e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "42703";

function triggerError(error: { message?: string; code?: string } | null, fallback: string): string {
  const msg = String(error?.message ?? "");
  if (msg.includes("RD:exceeds_deposit")) return "Toplam kesinti depozitoyu aşamaz.";
  if (msg.includes("RD:deposit_returned")) return "Depozito iade edildi; kesintiyi değiştirmek için önce iadeyi geri alın.";
  if (msg.includes("RD:inspection_mismatch")) return "Kesinti bu kiranın tutanağına bağlanmalı.";
  if (msg.includes("RI:final")) return "Kesinleşen tutanak değiştirilemez; önce taslağa geri alın.";
  if (isMissing(error)) return MISSING;
  return actionErrorMessage(error, fallback);
}

function refresh(rentalId: string, kind?: InspectionKind) {
  revalidatePath(`/app/kiralama/${rentalId}`);
  if (kind) revalidatePath(`/app/kiralama/${rentalId}/tutanak/${KIND_SLUGS[kind]}`);
}

export type SaveInspectionInput = {
  rentalId: string;
  kind: string;
  inspectedOn: string;
  rooms: unknown;
  meters: unknown;
  keys: unknown;
  notes: string;
};

/** Taslak kaydet (otomatik kayıt da bunu çağırır). Tür başına tek tutanak; kesinleşmişse reddedilir. */
export async function saveInspection(input: SaveInspectionInput): Promise<InspectionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  const rentalId = String(input?.rentalId ?? "");
  const kind = String(input?.kind ?? "") as InspectionKind;
  if (!isUuid(rentalId) || !(INSPECTION_KINDS as readonly string[]).includes(kind)) return { error: "Geçersiz istek." };
  const inspectedOn = String(input?.inspectedOn ?? "").trim();
  if (!isIsoDate(inspectedOn)) return { error: "Tutanak tarihini seçin." };
  const rooms = normalizeRooms(input?.rooms);
  if (rooms.length === 0) return { error: "En az bir oda ekleyin." };
  const meters = normalizeMeters(input?.meters);
  const keys = normalizeKeys(input?.keys);
  const notes = String(input?.notes ?? "").trim().slice(0, 4000) || null;

  const supabase = await createClient();
  const { data: rental } = await supabase.from("rentals").select("id").eq("id", rentalId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };
  const { data: existing, error: exErr } = await supabase
    .from("rental_inspections")
    .select("id, status")
    .eq("rental_id", rentalId)
    .eq("tenant_id", gate.tenantId)
    .eq("kind", kind)
    .maybeSingle();
  if (exErr) return { error: triggerError(exErr, "Tutanak okunamadı; sayfayı yenileyip yeniden deneyin.") };
  if (existing?.status === "final") return { error: "Kesinleşen tutanak değiştirilemez; önce taslağa geri alın." };

  const payload = { inspected_on: inspectedOn, rooms, meters, keys, notes, updated_by: gate.userId };
  if (existing) {
    const { error } = await supabase.from("rental_inspections").update(payload).eq("id", existing.id).eq("tenant_id", gate.tenantId).eq("status", "draft");
    if (error) return { error: triggerError(error, "Tutanak kaydedilemedi; bağlantınızı kontrol edip Kaydet'e yeniden dokunun.") };
    refresh(rentalId);
    return { ok: true, id: existing.id };
  }
  const { data, error } = await supabase
    .from("rental_inspections")
    .insert({ tenant_id: gate.tenantId, rental_id: rentalId, kind, created_by: gate.userId, ...payload })
    .select("id")
    .single();
  if (error || !data) {
    // Aynı anda iki sekmeden ilk kayıt: tekil anahtar çakışması → kullanıcı sayfayı yenilesin.
    if (error?.code === "23505") return { error: "Bu tutanak başka bir sekmede oluşturuldu; sayfayı yenileyin." };
    return { error: triggerError(error, "Tutanak kaydedilemedi; bağlantınızı kontrol edip Kaydet'e yeniden dokunun.") };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "rental_inspection.create", entityType: "rental", entityId: rentalId, newValue: { kind, inspection_id: data.id } });
  refresh(rentalId);
  return { ok: true, id: data.id };
}

/** Kesinleştir: içerik kilitlenir, imzaya gönderilebilir. Tutanak kaydı önce `saveInspection` ile yazılmış olmalı. */
export async function finalizeInspection(id: string): Promise<InspectionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(id)) return { error: "Tutanak bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_inspections")
    .update({ status: "final", finalized_at: new Date(now()).toISOString(), updated_by: gate.userId })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "draft")
    .select("id, rental_id, kind")
    .maybeSingle();
  if (error) return { error: triggerError(error, "Tutanak kesinleştirilemedi.") };
  if (!data) return { error: "Tutanak zaten kesinleşmiş ya da bulunamadı." };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "rental_inspection.finalize", entityType: "rental", entityId: data.rental_id, newValue: { kind: data.kind, inspection_id: id } });
  refresh(data.rental_id, data.kind as InspectionKind);
  return { ok: true, id };
}

/** Taslağa geri al. İmzaya gönderilmiş/imzalanmış sözleşmesi olan tutanak geri alınamaz (kanıt bütünlüğü). */
export async function reopenInspection(id: string): Promise<InspectionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(id)) return { error: "Tutanak bulunamadı." };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("rental_inspections")
    .select("id, rental_id, kind, status, contract_id")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!row) return { error: "Tutanak bulunamadı." };
  if (row.status !== "final") return { ok: true, id };
  if (row.contract_id) {
    const { data: c } = await supabase.from("contracts").select("status").eq("id", row.contract_id).maybeSingle();
    if (c && (c.status === "sent" || c.status === "signed")) {
      return { error: "Tutanak imzaya gönderildi; değiştirmek için önce sözleşmeyi iptal edin." };
    }
  }
  const { error } = await supabase
    .from("rental_inspections")
    .update({ status: "draft", finalized_at: null, contract_id: null, updated_by: gate.userId })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "final");
  if (error) return { error: triggerError(error, "Tutanak taslağa alınamadı; sayfayı yenileyip yeniden deneyin.") };
  refresh(row.rental_id, row.kind as InspectionKind);
  return { ok: true, id };
}

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Kesinleşmiş tutanaktan imza taslağı (contracts, durum draft). Metin tutanaktan üretilir; danışman sözleşme sayfasında
 * imzalayanları (kiracı + malik) ekleyip SMS OTP ile gönderir. Mevcut taslak varsa onu döndürür.
 */
export async function createInspectionContract(id: string): Promise<InspectionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  const cGate = await requirePermission("contracts", "create");
  if (!cGate.ok) return { error: cGate.error };
  if (!isUuid(id)) return { error: "Tutanak bulunamadı." };
  const supabase = await createClient();
  const { data: insp } = await supabase
    .from("rental_inspections")
    .select("id, rental_id, kind, status, inspected_on, rooms, meters, keys, notes, contract_id")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!insp) return { error: "Tutanak bulunamadı." };
  if (insp.status !== "final") return { error: "Önce tutanağı kesinleştirin." };
  if (insp.contract_id) {
    const { data: c } = await supabase.from("contracts").select("id, status").eq("id", insp.contract_id).maybeSingle();
    if (c && c.status !== "cancelled" && c.status !== "rejected") return { ok: true, id: c.id };
  }

  const [{ data: rental }, { count: photoCount }, dedRes, { data: tenantRow }] = await Promise.all([
    supabase
      .from("rentals")
      .select("id, deposit, property:properties!rentals_property_id_fkey(id, title, property_code, address_line), renter:customers!rentals_renter_customer_id_fkey(id, full_name)")
      .eq("id", insp.rental_id)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
    supabase.from("rental_inspection_photos").select("id", { count: "exact", head: true }).eq("inspection_id", id).eq("status", "verified"),
    supabase.from("rental_deposit_deductions").select("label, amount").eq("rental_id", insp.rental_id).eq("tenant_id", gate.tenantId).order("created_at"),
    supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle(),
  ]);
  if (!rental) return { error: "Kira kaydı bulunamadı." };
  const property = one(rental.property as Rel<{ id: string; title: string | null; property_code: string | null; address_line: string | null }>);
  const renter = one(rental.renter as Rel<{ id: string; full_name: string | null }>);
  let landlordName: string | null = null;
  if (property) {
    const ownerRes = await supabase.from("property_owner_info").select("customer_id").eq("property_id", property.id).maybeSingle();
    const ownerId = (ownerRes.data as { customer_id?: string | null } | null)?.customer_id ?? null;
    if (ownerId) {
      const c = await supabase.from("customers").select("full_name").eq("id", ownerId).maybeSingle();
      landlordName = (c.data as { full_name?: string | null } | null)?.full_name ?? null;
    }
  }
  const kind = insp.kind as InspectionKind;
  const deductions = ((dedRes.data ?? []) as { label: string; amount: number | string }[]).map((d) => ({ label: d.label, amount: Number(d.amount) }));
  const propertyTitle = property?.title ?? property?.property_code ?? null;
  const body = buildInspectionBody({
    kind,
    inspectedOn: String(insp.inspected_on),
    propertyTitle,
    propertyAddress: property?.address_line ?? null,
    landlordName,
    renterName: renter?.full_name ?? null,
    officeName: (tenantRow as { name?: string | null } | null)?.name ?? null,
    rooms: normalizeRooms(insp.rooms),
    meters: normalizeMeters(insp.meters),
    keys: normalizeKeys(insp.keys),
    notes: insp.notes ?? null,
    photoCount: photoCount ?? 0,
    ...(kind === "move_out" ? { deductions, deposit: rental.deposit != null ? Number(rental.deposit) : null } : {}),
  });
  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      tenant_id: gate.tenantId,
      created_by: gate.userId,
      title: inspectionTitle(kind, propertyTitle, renter?.full_name ?? null),
      contract_type: "diger",
      body,
      property_id: property?.id ?? null,
      customer_id: renter?.id ?? null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !contract) return { error: actionErrorMessage(error, "İmza taslağı oluşturulamadı.") };
  await supabase.from("rental_inspections").update({ contract_id: contract.id, updated_by: gate.userId }).eq("id", id).eq("tenant_id", gate.tenantId);
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "rental_inspection.contract", entityType: "rental", entityId: insp.rental_id, newValue: { kind, contract_id: contract.id } });
  refresh(insp.rental_id, kind);
  revalidatePath("/app/sozlesmeler");
  return { ok: true, id: contract.id };
}

async function draftInspectionFor(tenantId: string, inspectionId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rental_inspections")
    .select("id, rental_id, kind, status")
    .eq("id", inspectionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data as { id: string; rental_id: string; kind: InspectionKind; status: string } | null;
}

/** Kalem fotoğrafı için tek nesnelik imzalı yükleme (özel kova). Yalnız taslak tutanakta. */
export async function prepareInspectionPhoto(
  inspectionId: string,
  itemKey: string,
  input: { fileName: string; fileSize: number; fileType: string },
): Promise<DirectFileUploadPrepareResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(inspectionId) || !isItemKey(itemKey)) return { error: "Önce tutanağı kaydedin." };
  const insp = await draftInspectionFor(gate.tenantId, inspectionId);
  if (!insp) return { error: "Önce tutanağı kaydedin." };
  if (insp.status !== "draft") return { error: "Kesinleşen tutanağa fotoğraf eklenemez." };
  const meta = validateDirectFileUploadMetadata("customer_file", {
    parentId: inspectionId,
    fileName: input?.fileName,
    fileSize: input?.fileSize,
    fileType: input?.fileType,
    label: null,
  });
  if (!meta.ok) return { error: meta.error };
  if (!PHOTO_MIME.includes(meta.value.claimedMime)) return { error: "JPG, PNG ya da WEBP fotoğraf yükleyin." };

  const admin = createAdminClient();
  const { count } = await admin
    .from("rental_inspection_photos")
    .select("id", { count: "exact", head: true })
    .eq("inspection_id", inspectionId)
    .eq("tenant_id", gate.tenantId)
    .in("status", ["pending", "verified"]);
  if ((count ?? 0) >= MAX_PHOTOS_PER_INSPECTION) return { error: `Bir tutanakta en çok ${MAX_PHOTOS_PER_INSPECTION} fotoğraf olabilir.` };

  const fileId = crypto.randomUUID();
  const path = buildDirectFileUploadPath(gate.tenantId, inspectionId, fileId, meta.value.canonicalExtension);
  const { error: insertError } = await admin.from("rental_inspection_photos").insert({
    id: fileId,
    tenant_id: gate.tenantId,
    inspection_id: inspectionId,
    item_key: itemKey,
    storage_path: path,
    file_name: meta.value.fileName,
    file_size: meta.value.fileSize,
    mime_type: meta.value.claimedMime,
    status: "pending",
    created_by: gate.userId,
  });
  if (insertError) return { error: triggerError(insertError, "Yükleme oturumu oluşturulamadı; birkaç saniye sonra fotoğrafı yeniden seçin.") };
  const { data: signed, error: signError } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (signError || !signed?.token || signed.path !== path) {
    await admin.from("rental_inspection_photos").update({ status: "blocked" }).eq("id", fileId).eq("status", "pending");
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

/** Yüklenen fotoğrafı bayt düzeyinde doğrular; başarıda kısa ömürlü önizleme URL'si döner. */
export async function finalizeInspectionPhoto(photoId: string): Promise<PhotoFinalizeResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(photoId)) return { error: "Yükleme oturumu geçersiz." };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("rental_inspection_photos")
    .select("id, inspection_id, storage_path, file_name, file_size, mime_type, status")
    .eq("id", photoId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!row) return { error: "Yükleme oturumu bulunamadı." };
  const storage = admin.storage.from(BUCKET);
  const preview = async () => (await storage.createSignedUrl(row.storage_path, 600)).data?.signedUrl;
  if (row.status === "verified") return { ok: true, id: row.id, url: await preview() };
  if (row.status !== "pending") return { error: "Fotoğraf güvenlik doğrulamasından geçemedi." };
  const block = async () => {
    await admin.from("rental_inspection_photos").update({ status: "blocked" }).eq("id", row.id);
    await storage.remove([row.storage_path]);
  };
  const { data: blob, error: downloadError } = await storage.download(row.storage_path);
  if (downloadError || !blob) return { error: "Yüklenen fotoğraf bulunamadı. Lütfen tekrar deneyin." };
  if (blob.size <= 0 || blob.size > DIRECT_FILE_UPLOAD_CONFIG.customer_file.maxBytes || blob.size !== Number(row.file_size)) {
    await block();
    return { error: "Yüklenen fotoğrafın boyutu beklenen değerle eşleşmiyor." };
  }
  const verified = await verifyDocumentFile(new File([blob], row.file_name, { type: row.mime_type }), DIRECT_FILE_UPLOAD_CONFIG.property_media.allowedMime);
  if (!verified.ok || verified.type !== row.mime_type) {
    await block();
    return { error: verified.ok ? "Fotoğraf içeriği bildirilen türle uyuşmuyor." : verified.error };
  }
  const { error } = await admin
    .from("rental_inspection_photos")
    .update({ status: "verified", verified_at: new Date(now()).toISOString() })
    .eq("id", row.id)
    .eq("status", "pending");
  if (error) return { error: "Fotoğraf doğrulandı ancak kaydedilemedi." };
  return { ok: true, id: row.id, url: await preview() };
}

/** Taslak tutanaktan fotoğraf siler (meta satırı + depodaki nesne). */
export async function deleteInspectionPhoto(photoId: string): Promise<InspectionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(photoId)) return { error: "Fotoğraf bulunamadı." };
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("rental_inspection_photos")
    .select("id, inspection_id, storage_path")
    .eq("id", photoId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!row) return { error: "Fotoğraf bulunamadı." };
  const insp = await draftInspectionFor(gate.tenantId, row.inspection_id);
  if (!insp || insp.status !== "draft") return { error: "Kesinleşen tutanaktan fotoğraf silinemez." };
  const { error } = await admin.from("rental_inspection_photos").delete().eq("id", row.id).eq("tenant_id", gate.tenantId);
  if (error) return { error: "Fotoğraf silinemedi; sayfayı yenileyip yeniden deneyin." };
  await admin.storage.from(BUCKET).remove([row.storage_path]);
  return { ok: true };
}

/** Kalemli depozito kesintisi ekler. Toplam depozitoyu aşamaz; iade edilmiş depozitoda değişiklik yok (DB kapısı). */
export async function addDepositDeduction(input: { rentalId: string; label: string; amount: string; inspectionId?: string | null; itemKey?: string | null }): Promise<InspectionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  const rentalId = String(input?.rentalId ?? "");
  if (!isUuid(rentalId)) return { error: "Kira kaydı bulunamadı." };
  const label = String(input?.label ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (label.length < 2) return { error: "Kesinti için kısa bir açıklama yazın (örn. Salon boyası)." };
  const amount = parseMoneyInput(input?.amount ?? "", { max: 99_999_999 });
  if (!amount.ok || amount.value == null || amount.value <= 0) return { error: "Geçerli bir kesinti tutarı yazın." };
  const inspectionId = input?.inspectionId && isUuid(input.inspectionId) ? input.inspectionId : null;
  const itemKey = input?.itemKey && isItemKey(input.itemKey) ? input.itemKey : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_deposit_deductions")
    .insert({ tenant_id: gate.tenantId, rental_id: rentalId, inspection_id: inspectionId, item_key: itemKey, label, amount: amount.value, created_by: gate.userId })
    .select("id")
    .single();
  if (error || !data) return { error: triggerError(error, "Kesinti eklenemedi; tutarı kontrol edip yeniden deneyin.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "rental_deposit.deduction_add", entityType: "rental", entityId: rentalId, newValue: { label, amount: amount.value } });
  refresh(rentalId, "move_out");
  return { ok: true, id: data.id };
}

export async function deleteDepositDeduction(id: string): Promise<InspectionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(id)) return { error: "Kesinti bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_deposit_deductions")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id, rental_id, label, amount")
    .maybeSingle();
  if (error) return { error: triggerError(error, "Kesinti silinemedi; sayfayı yenileyip yeniden deneyin.") };
  if (!data) return { error: "Kesinti bulunamadı." };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "rental_deposit.deduction_delete", entityType: "rental", entityId: data.rental_id, oldValue: { label: data.label, amount: data.amount } });
  refresh(data.rental_id, "move_out");
  return { ok: true };
}
