"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isKeyOut } from "@/lib/key-overdue";

/**
 * Anahtar & emanet takibi action'ları.
 *
 * Modül kapısı "properties" — bu özellik portföy modülünün altında yaşar
 * (ayrı modül kaydı YOK, bkz. permissions.ts'e dokunulmadı).
 *
 * Her mutasyon iki iz bırakır:
 *  1. property_key_events satırı (kullanıcıya görünen hareket geçmişi)
 *  2. logActivity (audit_logs — denetim izi)
 */

export type KeyResult = { error?: string; ok?: boolean };

export type PropertyKeyRow = {
  id: string;
  property_id: string;
  label: string;
  key_code: string | null;
  status: string;
  holder_staff_id: string | null;
  holder_name: string | null;
  holder_phone: string | null;
  taken_at: string | null;
  due_at: string | null;
  returned_at: string | null;
  note: string | null;
  created_at: string;
};

export type PropertyKeyEvent = {
  id: string;
  key_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  holder_name: string | null;
  note: string | null;
  created_at: string;
};

/**
 * Portföy detayı için anahtarlar + hareket geçmişi (bkz. getPropertyTimeline
 * deseni — sayfa tek çağrı yapar, sorgu şekli burada kalır).
 *
 * Geçmiş TEK sorguda, anahtar başına ayrı sorgu yok: satırlar key_id'ye göre
 * bellekte gruplanır (bir portföyde en fazla birkaç anahtar olur).
 */
export async function getPropertyKeys(propertyId: string): Promise<{
  keys: (PropertyKeyRow & { holder_staff_name: string | null })[];
  events: Record<string, PropertyKeyEvent[]>;
}> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return { keys: [], events: {} };

  const supabase = await createClient();
  const { data: keyRows } = await supabase
    .from("property_keys")
    .select(
      "id, property_id, label, key_code, status, holder_staff_id, holder_name, holder_phone, taken_at, due_at, returned_at, note, created_at, holder:profiles!property_keys_holder_staff_id_fkey(full_name)",
    )
    .eq("property_id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: true });

  type Joined = PropertyKeyRow & { holder: { full_name: string | null } | { full_name: string | null }[] | null };
  const keys = ((keyRows ?? []) as Joined[]).map((k) => {
    const rel = Array.isArray(k.holder) ? k.holder[0] : k.holder;
    const { holder: _holder, ...rest } = k;
    return { ...rest, holder_staff_name: rel?.full_name ?? null };
  });

  if (keys.length === 0) return { keys: [], events: {} };

  const { data: eventRows } = await supabase
    .from("property_key_events")
    .select("id, key_id, action, from_status, to_status, holder_name, note, created_at")
    .in("key_id", keys.map((k) => k.id))
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(300);

  const events: Record<string, PropertyKeyEvent[]> = {};
  for (const e of (eventRows ?? []) as PropertyKeyEvent[]) {
    (events[e.key_id] ??= []).push(e);
  }
  return { keys, events };
}

/** Portföyün bu tenant'a ait olduğunu doğrular — tüm mutasyonların ön koşulu. */
async function verifyProperty(propertyId: string, tenantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("id, property_code, title")
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

/** Anahtarı + bağlı portföyünü tek turda getirir. */
async function loadKey(keyId: string, tenantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("property_keys")
    .select("id, property_id, label, status, holder_staff_id, holder_name, due_at")
    .eq("id", keyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

/** Hem detay bölümünü hem panoyu tazeler (aksiyonlar iki yerden de tetiklenir). */
function revalidateKeyViews(propertyId: string) {
  revalidatePath(`/app/portfoyler/${propertyId}`);
  revalidatePath("/app/portfoyler/anahtarlar");
}

// ---------------------------------------------------------------------------
// Anahtar ekle
// ---------------------------------------------------------------------------
export async function addPropertyKey(_prev: KeyResult, fd: FormData): Promise<KeyResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(fd.get("property_id") ?? "").trim();
  const label = String(fd.get("label") ?? "").trim();
  const keyCode = String(fd.get("key_code") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim();

  if (!propertyId) return { error: "Portföy bulunamadı." };
  if (!label) return { error: "Anahtar etiketi boş olamaz." };
  if (label.length > 80) return { error: "Etiket en fazla 80 karakter olabilir." };
  if (keyCode.length > 40) return { error: "Anahtar kodu en fazla 40 karakter olabilir." };
  if (note.length > 500) return { error: "Not en fazla 500 karakter olabilir." };

  const property = await verifyProperty(propertyId, gate.tenantId);
  if (!property) return { error: "Portföy bulunamadı." };

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("property_keys")
    .insert({
      tenant_id: gate.tenantId,
      property_id: propertyId,
      label,
      key_code: keyCode || null,
      note: note || null,
      status: "ofiste",
      created_by: gate.userId,
    })
    .select("id")
    .maybeSingle();

  if (error || !inserted) {
    console.error("addPropertyKey", error);
    return { error: "Anahtar eklenemedi." };
  }

  await supabase.from("property_key_events").insert({
    tenant_id: gate.tenantId,
    key_id: inserted.id,
    action: "olusturma",
    to_status: "ofiste",
    staff_id: gate.userId,
    note: note || null,
  });

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.key.add",
    entityType: "property",
    entityId: propertyId,
    newValue: { key_id: inserted.id, label, key_code: keyCode || null },
  });

  revalidateKeyViews(propertyId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Çıkış ver
// ---------------------------------------------------------------------------
/**
 * Anahtarı birine teslim eder. İki mod:
 *  - holder_type=staff    → holder_staff_id zorunlu, durum "danisanda"
 *  - holder_type=customer → holder_name zorunlu, durum "musteride"
 * Vade (due_at) opsiyonel; UI varsayılanı +2 gün.
 */
export async function checkoutPropertyKey(_prev: KeyResult, fd: FormData): Promise<KeyResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const keyId = String(fd.get("key_id") ?? "").trim();
  const holderType = String(fd.get("holder_type") ?? "staff").trim();
  const staffId = String(fd.get("holder_staff_id") ?? "").trim();
  const holderName = String(fd.get("holder_name") ?? "").trim();
  const holderPhone = String(fd.get("holder_phone") ?? "").trim();
  const dueRaw = String(fd.get("due_at") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim();

  if (!keyId) return { error: "Anahtar bulunamadı." };
  if (note.length > 500) return { error: "Not en fazla 500 karakter olabilir." };

  const key = await loadKey(keyId, gate.tenantId);
  if (!key) return { error: "Anahtar bulunamadı." };
  if (key.status === "kayip") return { error: "Kayıp bildirilen anahtar için çıkış verilemez." };
  if (isKeyOut(key.status)) return { error: "Bu anahtar zaten dışarıda — önce iade alın." };

  const supabase = await createClient();

  let nextStatus: "danisanda" | "musteride";
  let staffValue: string | null = null;
  let nameValue: string | null = null;
  let phoneValue: string | null = null;
  let holderLabel: string;

  if (holderType === "staff") {
    if (!staffId) return { error: "Danışman seçin." };
    const { data: staff } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", staffId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!staff) return { error: "Danışman bulunamadı." };
    nextStatus = "danisanda";
    staffValue = staff.id;
    holderLabel = staff.full_name ?? "Danışman";
  } else {
    if (!holderName) return { error: "Kişi adı boş olamaz." };
    if (holderName.length > 120) return { error: "Kişi adı en fazla 120 karakter olabilir." };
    if (holderPhone.length > 30) return { error: "Telefon en fazla 30 karakter olabilir." };
    nextStatus = "musteride";
    nameValue = holderName;
    phoneValue = holderPhone || null;
    holderLabel = holderName;
  }

  // Tarih girdisi <input type="date"> → gün sonu (23:59) vade sayılır.
  let dueIso: string | null = null;
  if (dueRaw) {
    const parsed = new Date(`${dueRaw}T23:59:00`);
    if (Number.isNaN(parsed.getTime())) return { error: "İade vadesi geçersiz." };
    dueIso = parsed.toISOString();
  }

  const takenAt = new Date().toISOString();
  const { error } = await supabase
    .from("property_keys")
    .update({
      status: nextStatus,
      holder_staff_id: staffValue,
      holder_name: nameValue,
      holder_phone: phoneValue,
      taken_at: takenAt,
      due_at: dueIso,
      returned_at: null,
      note: note || null,
    })
    .eq("id", keyId)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("checkoutPropertyKey", error);
    return { error: "Çıkış kaydedilemedi." };
  }

  await supabase.from("property_key_events").insert({
    tenant_id: gate.tenantId,
    key_id: keyId,
    action: "cikis",
    from_status: key.status,
    to_status: nextStatus,
    holder_name: holderLabel,
    staff_id: staffValue ?? gate.userId,
    note: note || null,
  });

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.key.checkout",
    entityType: "property",
    entityId: key.property_id,
    oldValue: { status: key.status },
    newValue: { key_id: keyId, label: key.label, status: nextStatus, holder: holderLabel, due_at: dueIso },
  });

  revalidateKeyViews(key.property_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// İade al (tek tık) — hem detay bölümünden hem panodan çağrılır
// ---------------------------------------------------------------------------
export async function returnPropertyKey(fd: FormData): Promise<void> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return;

  const keyId = String(fd.get("key_id") ?? "").trim();
  if (!keyId) return;

  const key = await loadKey(keyId, gate.tenantId);
  if (!key) return;

  const supabase = await createClient();
  const returnedAt = new Date().toISOString();
  const { error } = await supabase
    .from("property_keys")
    .update({
      status: "ofiste",
      holder_staff_id: null,
      holder_name: null,
      holder_phone: null,
      due_at: null,
      returned_at: returnedAt,
    })
    .eq("id", keyId)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("returnPropertyKey", error);
    return;
  }

  await supabase.from("property_key_events").insert({
    tenant_id: gate.tenantId,
    key_id: keyId,
    action: "iade",
    from_status: key.status,
    to_status: "ofiste",
    holder_name: key.holder_name,
    staff_id: gate.userId,
  });

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.key.return",
    entityType: "property",
    entityId: key.property_id,
    oldValue: { status: key.status, holder: key.holder_name },
    newValue: { key_id: keyId, label: key.label, status: "ofiste", returned_at: returnedAt },
  });

  revalidateKeyViews(key.property_id);
}

// ---------------------------------------------------------------------------
// Kayıp bildir (ConfirmDialog formAction)
// ---------------------------------------------------------------------------
export async function reportPropertyKeyLost(fd: FormData): Promise<void> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return;

  const keyId = String(fd.get("key_id") ?? "").trim();
  if (!keyId) return;

  const key = await loadKey(keyId, gate.tenantId);
  if (!key) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("property_keys")
    .update({ status: "kayip", due_at: null })
    .eq("id", keyId)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("reportPropertyKeyLost", error);
    return;
  }

  await supabase.from("property_key_events").insert({
    tenant_id: gate.tenantId,
    key_id: keyId,
    action: "kayip",
    from_status: key.status,
    to_status: "kayip",
    holder_name: key.holder_name,
    staff_id: gate.userId,
  });

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.key.lost",
    entityType: "property",
    entityId: key.property_id,
    oldValue: { status: key.status },
    newValue: { key_id: keyId, label: key.label, status: "kayip" },
  });

  revalidateKeyViews(key.property_id);
}

// ---------------------------------------------------------------------------
// Sil (ConfirmDialog formAction) — events cascade ile gider
// ---------------------------------------------------------------------------
export async function deletePropertyKey(fd: FormData): Promise<void> {
  const gate = await requirePermission("properties", "delete");
  if (!gate.ok) return;

  const keyId = String(fd.get("key_id") ?? "").trim();
  if (!keyId) return;

  const key = await loadKey(keyId, gate.tenantId);
  if (!key) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("property_keys")
    .delete()
    .eq("id", keyId)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("deletePropertyKey", error);
    return;
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.key.delete",
    entityType: "property",
    entityId: key.property_id,
    oldValue: { key_id: keyId, label: key.label, status: key.status },
  });

  revalidateKeyViews(key.property_id);
}
