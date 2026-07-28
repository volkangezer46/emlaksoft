"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { triggerPlaybooks } from "@/lib/playbook-trigger";
import { isValidOptionalTurkishMobile, normalizeTurkishPhone, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { daysFromNowIso } from "@/lib/clock";

export type CustomerResult = { error?: string; ok?: boolean; id?: string };

/** Boş ise geçerli; dolu ise ISO tarih (YYYY-MM-DD) formatını ve gerçek takvim gününü doğrular. */
function isValidOptionalDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export async function createCustomer(
  _prev: CustomerResult,
  formData: FormData,
): Promise<CustomerResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const tenantId = gate.tenantId;
  const user = { id: gate.userId };

  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const birthDate = String(formData.get("birth_date") ?? "").trim();
  const anniversaryDate = String(formData.get("anniversary_date") ?? "").trim();
  const anniversaryNote = String(formData.get("anniversary_note") ?? "").trim();

  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (!isValidOptionalTurkishMobile(phone)) return { error: TR_MOBILE_ERROR_MESSAGE };
  if (!isValidOptionalDate(birthDate)) return { error: "Doğum tarihi geçersiz." };
  if (!isValidOptionalDate(anniversaryDate)) return { error: "Yıldönümü tarihi geçersiz." };
  const normalizedPhone = phone ? normalizeTurkishPhone(phone) : "";

  const { data, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: tenantId,
      full_name: fullName,
      phone: normalizedPhone || null,
      email: email || null,
      customer_types: type ? [type] : [],
      province_id: provinceId || null,
      district_id: districtId || null,
      branch_id: branchId || null,
      notes: notes || null,
      birth_date: birthDate || null,
      anniversary_date: anniversaryDate || null,
      anniversary_note: anniversaryNote || null,
      assigned_to: user.id,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("createCustomer", error);
    return { error: "Müşteri eklenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId,
    actorId: gate.userId,
    action: "customer.create",
    entityType: "customer",
    entityId: data.id,
    newValue: { full_name: fullName },
  });

  // Otomasyon tetikle — hata ana işlemi asla bozmasın
  try {
    await dispatchAutomationEvent(tenantId, "new_customer", {
      entityType: "customer",
      entityId: data.id,
      customerId: data.id,
      label: fullName,
      phone: normalizedPhone || null,
      assignedTo: user.id,
    });
  } catch (e) {
    console.error("automation new_customer", e);
  }

  // İş akışı (playbook) tetikle — çok adımlı görev paketi; hata ana işlemi bozmaz
  await triggerPlaybooks({
    tenantId,
    event: "yeni_musteri",
    actorId: user.id,
    entity: {
      type: "customer",
      id: data.id,
      label: fullName,
      ownerId: user.id,
      customerId: data.id,
      fields: { customer_type: type || null },
    },
  });

  revalidatePath("/app/musteriler");
  return { ok: true, id: data.id };
}

export async function updateCustomer(
  _prev: CustomerResult,
  formData: FormData,
): Promise<CustomerResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const birthDate = String(formData.get("birth_date") ?? "").trim();
  const anniversaryDate = String(formData.get("anniversary_date") ?? "").trim();
  const anniversaryNote = String(formData.get("anniversary_note") ?? "").trim();

  if (!id) return { error: "Müşteri bulunamadı." };
  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (!isValidOptionalTurkishMobile(phone)) return { error: TR_MOBILE_ERROR_MESSAGE };
  if (!isValidOptionalDate(birthDate)) return { error: "Doğum tarihi geçersiz." };
  if (!isValidOptionalDate(anniversaryDate)) return { error: "Yıldönümü tarihi geçersiz." };
  const normalizedPhone = phone ? normalizeTurkishPhone(phone) : "";

  const supabase = await createClient();
  const updatePatch: Record<string, unknown> = {
    full_name: fullName,
    phone: normalizedPhone || null,
    email: email || null,
    customer_types: type ? [type] : [],
    province_id: provinceId || null,
    district_id: districtId || null,
    notes: notes || null,
    birth_date: birthDate || null,
    anniversary_date: anniversaryDate || null,
    anniversary_note: anniversaryNote || null,
  };
  if (formData.has("branch_id")) updatePatch.branch_id = branchId || null;

  const { error } = await supabase
    .from("customers")
    .update(updatePatch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateCustomer", error);
    return { error: "Müşteri güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.update",
    entityType: "customer",
    entityId: id,
    newValue: { full_name: fullName },
  });

  revalidatePath("/app/musteriler");
  revalidatePath(`/app/musteriler/${id}`);
  return { ok: true, id };
}

export async function deleteCustomer(formData: FormData): Promise<void> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "");
  const redirectTo = String(formData.get("redirect_to") ?? "").trim();
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deleteCustomer", error);
    return;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.delete",
    entityType: "customer",
    entityId: id,
  });
  revalidatePath("/app/musteriler");
  if (redirectTo) redirect(redirectTo);
}

export type BulkCustomerResult = { ok?: boolean; error?: string; updatedCount?: number };

/** Toplu işlem üst sınırı — tek istekte devasa update'leri engeller. */
const BULK_LIMIT = 200;

/** Seçilen id'lerden yalnızca bu tenanta ait ve silinmemiş olanları döndürür (güvenlik). */
async function resolveTenantCustomerIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  ids: string[],
): Promise<string[]> {
  const { data } = await supabase
    .from("customers")
    .select("id")
    .in("id", ids)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  return (data ?? []).map((r) => r.id as string);
}

/** Birden fazla müşteriye toplu danışman atama (listeden checkbox seçimiyle). */
export async function bulkAssignCustomers(
  ids: string[],
  assignedTo: string,
): Promise<BulkCustomerResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!ids.length) return { error: "Müşteri seçilmedi." };
  if (ids.length > BULK_LIMIT) return { error: `Tek seferde en fazla ${BULK_LIMIT} müşteri güncellenebilir.` };

  const supabase = await createClient();
  const validIds = await resolveTenantCustomerIds(supabase, gate.tenantId, ids);
  if (!validIds.length) return { error: "Güncellenecek müşteri bulunamadı." };

  const { error } = await supabase
    .from("customers")
    .update({ assigned_to: assignedTo || null })
    .in("id", validIds)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("bulkAssignCustomers", error);
    return { error: "Danışman ataması yapılamadı." };
  }

  // Audit log (tek kayıt, toplu temsil — bkz. bulkUpdatePropertyStatus deseni)
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.bulk_assign",
    entityType: "customer",
    newValue: { ids: validIds, assigned_to: assignedTo || null, count: validIds.length },
  });

  revalidatePath("/app/musteriler");
  for (const id of validIds) revalidatePath(`/app/musteriler/${id}`);
  return { ok: true, updatedCount: validIds.length };
}

/** Birden fazla müşteriyi toplu soft delete (deleted_at) ile siler. */
export async function bulkDeleteCustomers(ids: string[]): Promise<BulkCustomerResult> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!ids.length) return { error: "Müşteri seçilmedi." };
  if (ids.length > BULK_LIMIT) return { error: `Tek seferde en fazla ${BULK_LIMIT} müşteri silinebilir.` };

  const supabase = await createClient();
  const validIds = await resolveTenantCustomerIds(supabase, gate.tenantId, ids);
  if (!validIds.length) return { error: "Silinecek müşteri bulunamadı." };

  const { error } = await supabase
    .from("customers")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", validIds)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("bulkDeleteCustomers", error);
    return { error: "Müşteriler silinemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.bulk_delete",
    entityType: "customer",
    newValue: { ids: validIds, count: validIds.length },
  });

  revalidatePath("/app/musteriler");
  return { ok: true, updatedCount: validIds.length };
}

/**
 * "Yeniden ısıt" — uykuda (uzun süredir temassız) müşterilere toplu arama
 * görevi açar. Görev müşterinin danışmanına (assigned_to) düşer; danışmansızsa
 * işlemi yapan kullanıcıya. Aynı müşteride hâlâ AÇIK bir ısıtma görevi varsa
 * mükerrer üretmez (atlanır). SMS/İYS bilinçli olarak kapsam dışı.
 */
const REHEAT_MARK = "uzun süredir temassız";

export async function bulkReheatCustomers(ids: string[]): Promise<BulkCustomerResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!ids.length) return { error: "Müşteri seçilmedi." };
  if (ids.length > BULK_LIMIT) return { error: `Tek seferde en fazla ${BULK_LIMIT} müşteri için görev oluşturulabilir.` };

  const supabase = await createClient();
  const { data, error: loadError } = await supabase
    .from("customers")
    .select("id, full_name, assigned_to")
    .in("id", ids)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null);
  if (loadError) {
    console.error("bulkReheatCustomers load", loadError);
    return { error: "Müşteriler yüklenemedi. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []) as Array<{ id: string; full_name: string; assigned_to: string | null }>;
  if (!rows.length) return { error: "Görev açılacak müşteri bulunamadı." };

  // Mükerrer freni: bu müşteriler için hâlâ açık ısıtma görevi var mı?
  const { data: existing, error: taskErr } = await supabase
    .from("tasks")
    .select("customer_id")
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open")
    .in("customer_id", rows.map((r) => r.id))
    .like("title", `%${REHEAT_MARK}%`);
  if (taskErr) {
    console.error("bulkReheatCustomers tasks", taskErr);
    return { error: "Mevcut görevler kontrol edilemedi. Lütfen tekrar deneyin." };
  }
  const alreadyOpen = new Set((existing ?? []).map((t) => t.customer_id as string));
  const fresh = rows.filter((r) => !alreadyOpen.has(r.id));
  if (!fresh.length) {
    return { error: "Seçili müşterilerin tümünde zaten açık bir yeniden ısıtma görevi var." };
  }

  const dueAt = daysFromNowIso(2); // 2 gün içinde aranmalı
  const { error } = await supabase.from("tasks").insert(
    fresh.map((c) => ({
      tenant_id: gate.tenantId,
      title: `Ara: ${c.full_name} — ${REHEAT_MARK}`,
      notes: "Sıcaklık segmenti 'Uykuda' — müşteriyle yeniden temas kurun (yeniden ısıtma).",
      kind: "call",
      priority: "high",
      status: "open",
      due_at: dueAt,
      assigned_to: c.assigned_to ?? gate.userId,
      customer_id: c.id,
      created_by: gate.userId,
    })),
  );
  if (error) {
    console.error("bulkReheatCustomers insert", error);
    return { error: "Görevler oluşturulamadı. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.bulk_reheat",
    entityType: "customer",
    newValue: { ids: fresh.map((c) => c.id), count: fresh.length },
  });

  revalidatePath("/app/musteriler");
  revalidatePath("/app/gorevler");
  return { ok: true, updatedCount: fresh.length };
}

// ============================================================
// Müşteri etiketleri (segmentasyon — chip input + toplu etiketleme)
// ============================================================

/** Etiket sınırları — müşteri başına adet ve karakter uzunluğu. */
const TAG_MAX_COUNT = 10;
const TAG_MAX_LEN = 30;

/** Normalize: baş/son boşluk kırpılır, iç boşluklar teke iner. */
function normalizeTag(raw: string): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

/** Türkçe duyarlı karşılaştırma anahtarı — "VIP" ile "vip" aynı etikettir. */
function tagKey(tag: string): string {
  return tag.toLocaleLowerCase("tr-TR");
}

function validateTag(tag: string): string | null {
  if (!tag) return "Etiket boş olamaz.";
  if (tag.length > TAG_MAX_LEN) return `Etiket en fazla ${TAG_MAX_LEN} karakter olabilir.`;
  return null;
}

export type CustomerTagResult = { ok?: boolean; error?: string; tags?: string[] };

/** Müşterinin güncel etiketlerini tenant doğrulamasıyla yükler. */
async function loadCustomerTags(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  customerId: string,
): Promise<{ tags: string[] } | { error: string }> {
  const { data, error } = await supabase
    .from("customers")
    .select("tags")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("loadCustomerTags", error);
    return { error: "Etiketler yüklenemedi. Lütfen tekrar deneyin." };
  }
  if (!data) return { error: "Müşteri bulunamadı." };
  return { tags: (data.tags ?? []) as string[] };
}

/** Müşteriye tek etiket ekler (mükerrer eklemez, sınırları uygular). */
export async function addCustomerTag(
  customerId: string,
  tag: string,
): Promise<CustomerTagResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(customerId ?? "").trim();
  if (!id) return { error: "Müşteri bulunamadı." };
  const clean = normalizeTag(tag);
  const invalid = validateTag(clean);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const loaded = await loadCustomerTags(supabase, gate.tenantId, id);
  if ("error" in loaded) return { error: loaded.error };

  if (loaded.tags.some((t) => tagKey(t) === tagKey(clean))) {
    return { error: "Bu etiket zaten ekli." };
  }
  if (loaded.tags.length >= TAG_MAX_COUNT) {
    return { error: `Bir müşteriye en fazla ${TAG_MAX_COUNT} etiket eklenebilir.` };
  }

  const nextTags = [...loaded.tags, clean];
  const { error } = await supabase
    .from("customers")
    .update({ tags: nextTags })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("addCustomerTag", error);
    return { error: "Etiket eklenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.tag_add",
    entityType: "customer",
    entityId: id,
    newValue: { tag: clean, tags: nextTags },
  });

  revalidatePath("/app/musteriler");
  revalidatePath(`/app/musteriler/${id}`);
  return { ok: true, tags: nextTags };
}

/** Müşteriden etiket çıkarır (× ile). */
export async function removeCustomerTag(
  customerId: string,
  tag: string,
): Promise<CustomerTagResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(customerId ?? "").trim();
  if (!id) return { error: "Müşteri bulunamadı." };
  const clean = normalizeTag(tag);
  if (!clean) return { error: "Etiket boş olamaz." };

  const supabase = await createClient();
  const loaded = await loadCustomerTags(supabase, gate.tenantId, id);
  if ("error" in loaded) return { error: loaded.error };

  const nextTags = loaded.tags.filter((t) => tagKey(t) !== tagKey(clean));
  if (nextTags.length === loaded.tags.length) return { error: "Etiket bulunamadı." };

  const { error } = await supabase
    .from("customers")
    .update({ tags: nextTags })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("removeCustomerTag", error);
    return { error: "Etiket kaldırılamadı. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.tag_remove",
    entityType: "customer",
    entityId: id,
    newValue: { tag: clean, tags: nextTags },
  });

  revalidatePath("/app/musteriler");
  revalidatePath(`/app/musteriler/${id}`);
  return { ok: true, tags: nextTags };
}

/**
 * Seçili müşterilere toplu etiket ekleme (append) — mükerrer eklemez,
 * etiket sınırı dolu olan müşteriler atlanır (bkz. bulkAssignCustomers deseni).
 */
export async function bulkAddTag(ids: string[], tag: string): Promise<BulkCustomerResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!ids.length) return { error: "Müşteri seçilmedi." };
  if (ids.length > BULK_LIMIT) return { error: `Tek seferde en fazla ${BULK_LIMIT} müşteri güncellenebilir.` };

  const clean = normalizeTag(tag);
  const invalid = validateTag(clean);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { data, error: loadError } = await supabase
    .from("customers")
    .select("id, tags")
    .in("id", ids)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null);
  if (loadError) {
    console.error("bulkAddTag load", loadError);
    return { error: "Müşteriler yüklenemedi. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []) as Array<{ id: string; tags: string[] | null }>;
  if (!rows.length) return { error: "Güncellenecek müşteri bulunamadı." };

  // Etiket array kolonunda satır bazlı append gerekir — tek update tüm
  // diziyi ezerdi. Zaten etiketli ve sınırı dolu satırlar atlanır.
  let updatedCount = 0;
  const updatedIds: string[] = [];
  for (const row of rows) {
    const current = row.tags ?? [];
    if (current.some((t) => tagKey(t) === tagKey(clean))) continue; // mükerrer
    if (current.length >= TAG_MAX_COUNT) continue; // sınır dolu
    const { error } = await supabase
      .from("customers")
      .update({ tags: [...current, clean] })
      .eq("id", row.id)
      .eq("tenant_id", gate.tenantId);
    if (error) {
      console.error("bulkAddTag update", row.id, error);
      return { error: "Bazı müşteriler etiketlenemedi. Lütfen tekrar deneyin." };
    }
    updatedCount += 1;
    updatedIds.push(row.id);
  }
  if (updatedCount === 0) {
    return { error: "Seçili müşterilerin tümünde bu etiket zaten var (veya etiket sınırı dolu)." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.bulk_tag",
    entityType: "customer",
    newValue: { tag: clean, ids: updatedIds, count: updatedCount },
  });

  revalidatePath("/app/musteriler");
  for (const id of updatedIds) revalidatePath(`/app/musteriler/${id}`);
  return { ok: true, updatedCount };
}

// ============================================================
// Müşteri birleştirme (X6 — çift kayıt sihirbazı)
// ============================================================

/**
 * customer_id kolonu taşınan alt kayıt tabloları — migrations'tan tespit
 * edildi (grep customer_id). Bu listeler artık YALNIZ getMergePreview'in
 * sayım sorguları için; asıl taşımayı yapan tek doğruluk kaynağı DB
 * fonksiyonu `public.merge_customers`tır (migration 20260726000093).
 * Yeni tablo eklenirse HEM burası HEM o fonksiyon güncellenmeli.
 *
 * Bilinçli olarak taşınmayanlar:
 *  - kvkk_erasure_log: tarihsel denetim kaydı, FK'sız; geçmişi değiştirmek
 *    KVKK izini bozar.
 *  - open_house_visitors.created_customer_id: "bu ziyaretçiden şu müşteri
 *    yaratıldı" tarihsel bağı; taşımak kaynak istatistiğini bozar.
 */
const MERGE_MOVE_TABLES: ReadonlyArray<{ table: string; label: string }> = [
  { table: "customer_demands", label: "talep" },
  { table: "calls", label: "çağrı" },
  { table: "appointments", label: "randevu" },
  { table: "offers", label: "teklif" },
  { table: "contracts", label: "sözleşme" },
  { table: "deals", label: "anlaşma" },
  { table: "tasks", label: "görev" },
  { table: "communications", label: "görüşme" },
  { table: "customer_files", label: "dosya" },
  { table: "payment_links", label: "ödeme linki" },
  { table: "customer_portal_tokens", label: "portal erişimi" },
];

/**
 * Benzersizlik kısıtı olan alt tablolar — düz `update ... in (dupIds)`
 * unique ihlaliyle patlar. Ana kayıtta aynı anahtar yoksa taşınır; varsa
 * satır soft-delete'li duplicate üzerinde kalır (veri kaybı yok).
 *  - iys_consents:          unique(tenant_id, customer_id, channel)
 *  - portal_match_feedback: unique(customer_id, property_id)
 *  - lost_sale_dismissals:  unique(tenant_id, customer_id)
 */
const MERGE_UNIQUE_TABLES: ReadonlyArray<{ table: string; label: string; keyCols: string[] }> = [
  { table: "iys_consents", label: "İYS izni", keyCols: ["channel"] },
  { table: "portal_match_feedback", label: "portal geri bildirimi", keyCols: ["property_id"] },
  { table: "lost_sale_dismissals", label: "kayıp satış ertelemesi", keyCols: [] },
];

type CustomerMergeRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  source: string | null;
  birth_date: string | null;
  anniversary_date: string | null;
  anniversary_note: string | null;
  province_id: string | null;
  district_id: string | null;
  branch_id: string | null;
  customer_types: string[] | null;
  tags: string[] | null;
  created_at: string;
};

const MERGE_FILL_FIELDS: ReadonlyArray<{ field: keyof CustomerMergeRow; label: string }> = [
  { field: "phone", label: "Telefon" },
  { field: "email", label: "E-posta" },
  { field: "notes", label: "Notlar" },
  { field: "source", label: "Kaynak" },
  { field: "birth_date", label: "Doğum tarihi" },
  { field: "anniversary_date", label: "Yıldönümü" },
  { field: "anniversary_note", label: "Yıldönümü notu" },
  { field: "province_id", label: "İl bilgisi" },
  { field: "district_id", label: "İlçe bilgisi" },
  { field: "branch_id", label: "Şube bilgisi" },
];

/**
 * Ana kayıtta BOŞ olan alanları duplicate'lerden (eskiden yeniye) doldurur.
 * Ana kayıt doluysa asla dokunulmaz. customer_types/tags dizileri birleşir.
 */
function computeFillPatch(primary: CustomerMergeRow, dups: CustomerMergeRow[]) {
  const patch: Record<string, unknown> = {};
  const filled: Array<{ label: string; value: string }> = [];
  for (const { field, label } of MERGE_FILL_FIELDS) {
    if (primary[field]) continue; // ana doluysa dokunma
    const donor = dups.find((d) => d[field]);
    if (!donor) continue;
    patch[field] = donor[field];
    filled.push({ label, value: String(donor[field]) });
  }
  const mergedTypes = [...new Set([...(primary.customer_types ?? []), ...dups.flatMap((d) => d.customer_types ?? [])])];
  if (mergedTypes.length > (primary.customer_types ?? []).length) {
    patch.customer_types = mergedTypes;
    filled.push({ label: "Müşteri tipi", value: mergedTypes.join(", ") });
  }
  const mergedTags = [...new Set([...(primary.tags ?? []), ...dups.flatMap((d) => d.tags ?? [])])];
  if (mergedTags.length > (primary.tags ?? []).length) {
    patch.tags = mergedTags;
    filled.push({ label: "Etiketler", value: mergedTags.join(", ") });
  }
  return { patch, filled };
}

const MERGE_SELECT_COLS =
  "id, full_name, phone, email, notes, source, birth_date, anniversary_date, anniversary_note, province_id, district_id, branch_id, customer_types, tags, created_at";

/** Ana + duplicate kayıtları tenant doğrulamasıyla yükler (silinmişler hariç). */
async function loadMergeParties(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  primaryId: string,
  duplicateIds: string[],
): Promise<{ primary: CustomerMergeRow; dups: CustomerMergeRow[] } | { error: string }> {
  const { data, error } = await supabase
    .from("customers")
    .select(MERGE_SELECT_COLS)
    .in("id", [primaryId, ...duplicateIds])
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("loadMergeParties", error);
    return { error: "Kayıtlar yüklenemedi. Lütfen tekrar deneyin." };
  }
  const rows = (data ?? []) as CustomerMergeRow[];
  const primary = rows.find((r) => r.id === primaryId);
  const dups = rows.filter((r) => duplicateIds.includes(r.id));
  if (!primary || dups.length !== duplicateIds.length) {
    return { error: "Kayıtlardan bazıları bulunamadı veya silinmiş." };
  }
  return { primary, dups };
}

export type MergePreview = {
  ok?: boolean;
  error?: string;
  counts?: Array<{ label: string; count: number }>;
  totalMoves?: number;
  filled?: Array<{ label: string; value: string }>;
};

/**
 * Birleştirme sihirbazı 2. adım özeti: taşınacak alt kayıt sayıları (gerçek
 * count sorguları) + ana kayda kopyalanacak boş alanlar. Hiçbir şey yazmaz.
 */
export async function getMergePreview(
  primaryId: string,
  duplicateIds: string[],
): Promise<MergePreview> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!primaryId || !duplicateIds.length) return { error: "Kayıt seçilmedi." };
  if (duplicateIds.includes(primaryId)) return { error: "Ana kayıt duplicate listesinde olamaz." };

  const supabase = await createClient();
  const parties = await loadMergeParties(supabase, gate.tenantId, primaryId, duplicateIds);
  if ("error" in parties) return { error: parties.error };

  const counts: Array<{ label: string; count: number }> = [];
  let totalMoves = 0;
  for (const t of [...MERGE_MOVE_TABLES, ...MERGE_UNIQUE_TABLES]) {
    const { count, error } = await supabase
      .from(t.table)
      .select("id", { count: "exact", head: true })
      .in("customer_id", duplicateIds)
      .eq("tenant_id", gate.tenantId);
    if (error) {
      console.error(`getMergePreview ${t.table}`, error);
      continue;
    }
    if (count) {
      counts.push({ label: t.label, count });
      totalMoves += count;
    }
  }

  const { filled } = computeFillPatch(parties.primary, parties.dups);
  return { ok: true, counts, totalMoves, filled };
}

export type MergeResult = {
  ok?: boolean;
  error?: string;
  primaryId?: string;
  movedTotal?: number;
  deletedCount?: number;
};

/** Tek birleştirmede en fazla bu kadar duplicate kabul edilir. */
const MERGE_DUP_LIMIT = 10;

/**
 * Müşteri birleştirme — geri alınamaz.
 *
 * Tüm yazma işi TEK TRANSACTION'da DB fonksiyonunda yapılır:
 * `public.merge_customers` (migration 20260726000093) alt kayıt taşıma,
 * benzersiz kısıtlı tablolar, share_links, boş alan doldurma, soft delete
 * ve audit kaydını atomik yürütür — ya hepsi ya hiçbiri. Taşınan tablo
 * listesinin TEK doğruluk kaynağı o fonksiyondur; buradaki
 * MERGE_MOVE_TABLES/MERGE_UNIQUE_TABLES yalnız önizleme (getMergePreview)
 * içindir. Fonksiyon yalnız service_role çağırabilir; yetki kapısı ve ön
 * doğrulamalar bu action'da kalır.
 */
export async function mergeCustomers(
  primaryId: string,
  duplicateIds: string[],
): Promise<MergeResult> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return { error: gate.error };

  primaryId = String(primaryId ?? "").trim();
  duplicateIds = [...new Set((duplicateIds ?? []).map((s) => String(s).trim()).filter(Boolean))];
  if (!primaryId) return { error: "Ana kayıt seçilmedi." };
  if (!duplicateIds.length) return { error: "Birleştirilecek kayıt seçilmedi." };
  if (duplicateIds.includes(primaryId)) return { error: "Ana kayıt duplicate listesinde olamaz." };
  if (duplicateIds.length > MERGE_DUP_LIMIT) {
    return { error: `Tek seferde en fazla ${MERGE_DUP_LIMIT} kayıt birleştirilebilir.` };
  }

  // Ön doğrulama: kayıtlar bu tenant'a ait ve silinmemiş mi? (RPC de aynı
  // kontrolü yapar ama burada kullanıcıya net Türkçe hata dönebiliyoruz.)
  const supabase = await createClient();
  const tenantId = gate.tenantId;
  const parties = await loadMergeParties(supabase, tenantId, primaryId, duplicateIds);
  if ("error" in parties) return { error: parties.error };

  // Atomik birleştirme — RPC yalnız service_role'e açık, admin client şart.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("merge_customers", {
    p_tenant_id: tenantId,
    p_primary: primaryId,
    p_duplicates: duplicateIds,
    p_actor: gate.userId,
  });
  if (error) {
    console.error("mergeCustomers rpc", error);
    return { error: "Birleştirme tamamlanamadı; hiçbir kayıt değişmedi. Lütfen tekrar deneyin." };
  }

  const result = (data ?? {}) as { moved_total?: number; deleted_count?: number };

  revalidatePath("/app/musteriler");
  revalidatePath("/app/musteriler/cift-kayit");
  revalidatePath(`/app/musteriler/${primaryId}`);
  return {
    ok: true,
    primaryId,
    movedTotal: result.moved_total ?? 0,
    deletedCount: result.deleted_count ?? duplicateIds.length,
  };
}

/** Danışman (assigned_to) yeniden atama — ekip yönetimi ve devir için. */
export async function reassignCustomer(formData: FormData): Promise<void> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ assigned_to: assignedTo || null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("reassignCustomer", error);
    return;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.reassign",
    entityType: "customer",
    entityId: id,
    newValue: { assigned_to: assignedTo || null },
  });
  revalidatePath("/app/musteriler");
  revalidatePath(`/app/musteriler/${id}`);
}

/**
 * Müşteri notlarına tarih damgalı satır EKLER (mevcut not ezilmez).
 * Kullanım: Gelen kutusu satırındaki "Nota ekle" hızlı aksiyonu — mesaj
 * metni müşteri kartındaki notların sonuna iz olarak düşer. Geri alınamaz
 * ama düşük riskli olduğu için onay dialogu yok; UI toast ile bildirir.
 */
export async function appendCustomerNote(customerId: string, text: string): Promise<CustomerResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = customerId.trim();
  const line = text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!id) return { error: "Müşteri bulunamadı." };
  if (!line) return { error: "Eklenecek not metni boş." };

  const supabase = await createClient();
  const { data: customer, error: readError } = await supabase
    .from("customers")
    .select("id, notes")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError || !customer) return { error: "Müşteri bulunamadı." };

  // mergeCustomers'taki iz damgasıyla aynı biçim ailesi — tarih + saat.
  const stamp = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const trail = `[${stamp}] Gelen kutusundan: ${line}`;
  const { error } = await supabase
    .from("customers")
    .update({ notes: customer.notes ? `${customer.notes}\n${trail}` : trail })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("appendCustomerNote", error);
    return { error: "Not eklenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.note_append",
    entityType: "customer",
    entityId: id,
    newValue: { appended: trail },
  });

  revalidatePath(`/app/musteriler/${id}`);
  return { ok: true, id };
}
