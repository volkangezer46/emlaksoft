"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { getBaseUrl } from "@/lib/base-url";
import { now } from "@/lib/clock";
import { parseMoneyInput } from "@/lib/money-input";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { insertCustomerRecord } from "@/lib/customer-create";
import { validateTenantReferences } from "@/lib/tenant-references";
import { isUuid } from "@/lib/direct-file-uploads";
import {
  APPLICATION_LINK_TTL_DAYS,
  applicationLinkPath,
  canTransitionApplication,
  isApplicationStatus,
} from "@/lib/rentals/applications";
import { generateApplicationToken } from "@/lib/rentals/application-link.server";

/**
 * Kiracı başvurusu — ofis tarafı (SP5). Okuma/yazma oturumlu istemciyle (RLS: rentals:view / rentals:edit).
 * service_role yalnız evrakın kısa ömürlü imzalı okuma URL'si içindir (özel kova; nesne yolu tenant'a sabit satırdan).
 */

export type ApplicationActionResult = { ok?: boolean; error?: string; id?: string; url?: string };

const BUCKET = "customer-files";
const MISSING = "Kiracı başvurusu için veritabanı güncellemesi henüz uygulanmamış.";
const isMissing = (e: { code?: string } | null | undefined) => e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "42703";
const PATHS = (id?: string) => ["/app/kiralama/basvurular", ...(id ? [`/app/kiralama/basvurular/${id}`] : [])];

function refresh(id?: string) {
  for (const p of PATHS(id)) revalidatePath(p);
}

/**
 * Portföy için başvuru bağlantısı. Portföyde açık bağlantı varsa AYNISI döner (ilan metinlerindeki link bozulmasın);
 * `renew` ile eski kapatılıp yenisi açılır (sızan bağlantıyı iptal etmek için).
 */
export async function createApplicationLink(input: { propertyId: string; askingRent?: string; renew?: boolean }): Promise<ApplicationActionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  const propertyId = String(input?.propertyId ?? "").trim();
  if (!isUuid(propertyId)) return { error: "Portföy seçin." };
  const rent = parseMoneyInput(input?.askingRent ?? "", { max: 99_999_999 });
  if (!rent.ok) return { error: "Aylık kirayı yalnız rakamla yazın (örn. 25.000)." };
  const refs = await validateTenantReferences(gate.tenantId, { propertyId });
  if (!refs.ok) return { error: refs.error };

  const supabase = await createClient();
  const { data: existing, error: exErr } = await supabase
    .from("rental_application_links")
    .select("id, token")
    .eq("tenant_id", gate.tenantId)
    .eq("property_id", propertyId)
    .eq("status", "active")
    .maybeSingle();
  if (exErr) return { error: isMissing(exErr) ? MISSING : actionErrorMessage(exErr, "Bağlantı oluşturulamadı.") };
  if (existing && !input?.renew) {
    if (rent.value != null) {
      await supabase.from("rental_application_links").update({ asking_rent: rent.value }).eq("id", existing.id).eq("tenant_id", gate.tenantId);
    }
    return { ok: true, id: existing.id, url: `${getBaseUrl()}${applicationLinkPath(existing.token)}` };
  }
  if (existing) {
    await supabase
      .from("rental_application_links")
      .update({ status: "closed", closed_at: new Date(now()).toISOString() })
      .eq("id", existing.id)
      .eq("tenant_id", gate.tenantId);
  }
  const token = generateApplicationToken();
  const { data, error } = await supabase
    .from("rental_application_links")
    .insert({
      tenant_id: gate.tenantId,
      property_id: propertyId,
      token,
      asking_rent: rent.value,
      expires_at: new Date(now() + APPLICATION_LINK_TTL_DAYS * 86_400_000).toISOString(),
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createApplicationLink", { code: error?.code });
    return { error: isMissing(error) ? MISSING : actionErrorMessage(error, "Bağlantı oluşturulamadı.") };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "rental_application_link.create", entityType: "property", entityId: propertyId, newValue: { link_id: data.id } });
  refresh();
  return { ok: true, id: data.id, url: `${getBaseUrl()}${applicationLinkPath(token)}` };
}

export async function closeApplicationLink(linkId: string): Promise<ApplicationActionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(linkId)) return { error: "Bağlantı bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_application_links")
    .update({ status: "closed", closed_at: new Date(now()).toISOString() })
    .eq("id", linkId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Bağlantı kapatılamadı.") };
  if (!data) return { error: "Bağlantı zaten kapalı." };
  refresh();
  return { ok: true };
}

/** Durum değişikliği (kısa liste, malike öner, onay, ret). Geçiş kuralları SAF modelde; DB kapalı başvuruyu yeniden açtırmaz. */
export async function setApplicationStatus(id: string, status: string): Promise<ApplicationActionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(id) || !isApplicationStatus(status)) return { error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data: row, error: loadErr } = await supabase
    .from("rental_applications")
    .select("id, status, property_id")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (loadErr) return { error: isMissing(loadErr) ? MISSING : actionErrorMessage(loadErr, "Başvuru bulunamadı.") };
  if (!row) return { error: "Başvuru bulunamadı." };
  if (!isApplicationStatus(row.status) || !canTransitionApplication(row.status, status)) {
    return { error: "Bu başvuru bu duruma geçirilemez." };
  }
  const { data, error } = await supabase
    .from("rental_applications")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", row.status)
    .select("id")
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Durum güncellenemedi.") };
  if (!data) return { error: "Başvuru bu sırada değişti; sayfayı yenileyin." };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "rental_application.status", entityType: "rental_application", entityId: id, oldValue: { status: row.status }, newValue: { status } });
  refresh(id);
  return { ok: true };
}

/** Toplu durum: karşılaştırmadan "Malike öner" / "Kısa listeye al". Geçişi uymayan kayıt atlanır. */
export async function bulkSetApplicationStatus(ids: string[], status: string): Promise<{ ok?: boolean; error?: string; updated?: number; skipped?: number }> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  const list = Array.from(new Set((ids ?? []).filter(isUuid))).slice(0, 20);
  if (list.length === 0 || !isApplicationStatus(status)) return { error: "Geçersiz istek." };
  let updated = 0;
  let skipped = 0;
  for (const id of list) {
    const res = await setApplicationStatus(id, status);
    if (res.ok) updated += 1;
    else skipped += 1;
  }
  return { ok: updated > 0, updated, skipped, ...(updated === 0 ? { error: "Seçilen başvurular bu duruma geçirilemedi." } : {}) };
}

export async function saveApplicationNote(id: string, note: string): Promise<ApplicationActionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(id)) return { error: "Başvuru bulunamadı." };
  const clean = String(note ?? "").trim().slice(0, 2000);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_applications")
    .update({ office_note: clean || null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Not kaydedilemedi.") };
  if (!data) return { error: "Başvuru bulunamadı." };
  refresh(id);
  return { ok: true };
}

/**
 * Onaylanan adayı müşteriye dönüştürür. Aynı telefonlu müşteri varsa YENİ KAYIT AÇILMAZ, o müşteri bağlanır
 * (mükerrer müşteri yok). Dönüş: müşteri id (kira kaydı ön dolgusu için).
 */
export async function convertApplicationToCustomer(id: string): Promise<ApplicationActionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  const custGate = await requirePermission("customers", "create");
  if (!custGate.ok) return { error: custGate.error };
  if (!isUuid(id)) return { error: "Başvuru bulunamadı." };
  const supabase = await createClient();
  const { data: app } = await supabase
    .from("rental_applications")
    .select("id, full_name, phone, email, customer_id, status, occupation")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!app) return { error: "Başvuru bulunamadı." };
  if (app.customer_id) return { ok: true, id: app.customer_id };
  if (app.status !== "approved") return { error: "Önce adayı onaylayın (malik onayı ya da ofis onayı)." };

  const phone = parsePhoneStrict(app.phone);
  if (!phone.ok) return { error: "Adayın telefonu geçersiz; müşteri kaydını elle açın." };
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("phone", phone.stored)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  let customerId = existing?.id as string | undefined;
  if (!customerId) {
    const created = await insertCustomerRecord(supabase, { tenantId: gate.tenantId, userId: gate.userId }, {
      fullName: app.full_name,
      phone: phone.stored,
      email: app.email ?? "",
      type: "Kiracı",
      provinceId: "",
      districtId: "",
      branchId: "",
      notes: `Kiracı başvurusundan oluşturuldu${app.occupation ? ` · Meslek: ${app.occupation}` : ""}.`,
      birthDate: "",
      anniversaryDate: "",
      anniversaryNote: "",
    });
    if (!created.ok || !created.id) return { error: created.error ?? "Müşteri kaydı açılamadı; müşteriyi Müşteriler sayfasından elle ekleyin." };
    customerId = created.id;
  }
  const { error } = await supabase.from("rental_applications").update({ customer_id: customerId }).eq("id", id).eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Müşteri bağlanamadı.") };
  refresh(id);
  return { ok: true, id: customerId };
}

/** Evrakın 5 dakikalık imzalı okuma bağlantısı (özel kova). Satır RLS'le okunur → yol tenant'a sabittir. */
export async function getApplicationFileUrl(fileId: string): Promise<ApplicationActionResult> {
  const gate = await requirePermission("rentals", "view");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(fileId)) return { error: "Dosya bulunamadı." };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("rental_application_files")
    .select("id, storage_path, status, tenant_id")
    .eq("id", fileId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "verified")
    .maybeSingle();
  if (!row || !String(row.storage_path).startsWith(`${gate.tenantId}/`)) return { error: "Dosya bulunamadı." };
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(row.storage_path, 300);
  if (error || !data?.signedUrl) return { error: "Dosya bağlantısı oluşturulamadı; sayfayı yenileyip yeniden açın." };
  return { ok: true, url: data.signedUrl };
}

/** Kira kaydının kefil bilgisi (sözleşme {kefil} alanı). Boş ad = kefil kaldırılır. */
export async function saveRentalGuarantor(rentalId: string, fd: FormData): Promise<ApplicationActionResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(rentalId)) return { error: "Kira kaydı bulunamadı." };
  const name = String(fd.get("guarantor_name") ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const phoneRaw = String(fd.get("guarantor_phone") ?? "").trim();
  const address = String(fd.get("guarantor_address") ?? "").trim().slice(0, 500);
  let phone: string | null = null;
  if (name && phoneRaw) {
    const p = parsePhoneStrict(phoneRaw);
    if (!p.ok) return { error: `Kefil telefonu: ${p.error ?? "geçersiz numara"}` };
    phone = p.stored;
  }
  if (!name && (phoneRaw || address)) return { error: "Kefil adını yazın ya da tüm alanları boşaltın." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rentals")
    .update({ guarantor_name: name || null, guarantor_phone: name ? phone : null, guarantor_address: name ? address || null : null })
    .eq("id", rentalId)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return { error: isMissing(error) ? MISSING : actionErrorMessage(error, "Kefil kaydedilemedi.") };
  if (!data) return { error: "Kira kaydı bulunamadı." };
  revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true };
}
