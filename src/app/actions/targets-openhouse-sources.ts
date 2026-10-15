"use server";

import { revalidatePath } from "next/cache";
import { parseTrLocalDateTime } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { actionErrorMessage } from "@/lib/action-errors";

// Hedef aksiyonları src/app/actions/targets.ts dosyasına taşındı (OA4: dosya sahipliği).

// ============================================================
// 9. Açık ev
// ============================================================

export type OpenHouseResult = { ok?: boolean; error?: string; id?: string };

export async function createOpenHouse(
  _prev: OpenHouseResult,
  fd: FormData,
): Promise<OpenHouseResult> {
  const gate = await requirePermission("open_house", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId   = String(fd.get("property_id")   ?? "").trim();
  const scheduledAt  = String(fd.get("scheduled_at")  ?? "").trim();
  const durationMin  = parseInt(String(fd.get("duration_min") ?? "120"));
  const location     = String(fd.get("location")      ?? "").trim() || null;
  const notes        = String(fd.get("notes")         ?? "").trim() || null;
  const maxVisitors  = parseInt(String(fd.get("max_visitors") ?? "0")) || null;

  if (!propertyId)  return { error: "Portföy seçimi zorunludur." };
  if (!scheduledAt) return { error: "Tarih/saat zorunludur." };
  const scheduledDate = parseTrLocalDateTime(scheduledAt);
  if (!scheduledDate) return { error: "Geçerli bir tarih/saat girin." };
  if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 1_440) {
    return { error: "Süre 15-1440 dakika arasında olmalıdır." };
  }
  if (maxVisitors != null && (!Number.isInteger(maxVisitors) || maxVisitors < 1 || maxVisitors > 10_000)) {
    return { error: "Ziyaretçi kapasitesi 1-10000 arasında olmalıdır." };
  }
  if (location && location.length > 500) return { error: "Konum en fazla 500 karakter olabilir." };
  if (notes && notes.length > 5000) return { error: "Not en fazla 5000 karakter olabilir." };

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!property) return { error: "Portföy bulunamadı veya bu ofise ait değil." };

  const { data, error } = await supabase
    .from("open_houses")
    .insert({
      tenant_id:    gate.tenantId,
      property_id:  propertyId,
      created_by:   gate.userId,
      scheduled_at: scheduledDate.toISOString(),
      duration_min: durationMin,
      location,
      notes,
      max_visitors: maxVisitors,
      status:       "planned",
    })
    .select("id")
    .single();

  if (error || !data) return { error: actionErrorMessage(error, "Açık ev oluşturulamadı.") };

  revalidatePath("/app/acik-ev");
  return { ok: true, id: data.id };
}

export async function registerOpenHouseVisitor(
  openHouseId: string,
  visitor: { full_name: string; phone?: string; email?: string; notes?: string },
): Promise<OpenHouseResult> {
  const gate = await requirePermission("open_house", "create");
  if (!gate.ok) return { error: gate.error };

  const fullName = String(visitor.full_name ?? "").trim();
  const rawPhone = String(visitor.phone ?? "").trim();
  const parsedPhone = rawPhone ? parsePhoneStrict(rawPhone) : null;
  const phone = parsedPhone?.ok ? parsedPhone.stored : null;
  const email = normalizeEmail(String(visitor.email ?? "")) || null;
  const notes = String(visitor.notes ?? "").trim() || null;
  if (!fullName || fullName.length > 160) return { error: "Geçerli bir ad soyad girin." };
  if (parsedPhone && !parsedPhone.ok) return { error: PHONE_ERROR_MESSAGE };
  if (email && !isValidEmail(email)) {
    return { error: EMAIL_ERROR_MESSAGE };
  }
  if (notes && notes.length > 2000) return { error: "Not en fazla 2000 karakter olabilir." };

  const supabase = await createClient();

  const { data: openHouse } = await supabase
    .from("open_houses")
    .select("id")
    .eq("id", openHouseId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!openHouse) return { error: "Açık ev etkinliği bulunamadı." };

  const { error: visitorError } = await supabase.from("open_house_visitors").insert({
    open_house_id: openHouseId,
    full_name:     fullName,
    phone,
    email,
    notes,
  });
  if (visitorError) return { error: actionErrorMessage(visitorError, "Ziyaretçi kaydedilemedi.") };

  revalidatePath("/app/acik-ev");
  revalidatePath(`/app/acik-ev/${openHouseId}`);
  return { ok: true };
}

/**
 * Bir acik evin ziyaretci listesi.
 *
 * NEDEN SONRADAN EKLENDI: `open_house_visitors` tablosu YALNIZCA YAZILIYORDU.
 * `registerOpenHouseVisitor` kayit aciyordu ama hicbir ekran bu satirlari
 * okumuyordu — kartlarda sadece "N ziyaretci" sayaci gorunuyordu. Danisman
 * acik evde topladigi ismi bir daha goremiyordu; acik evin butun amaci olan
 * lead listesi sistemde olu veriydi.
 */
export async function listOpenHouseVisitors(openHouseId: string) {
  const gate = await requirePermission("open_house", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data: openHouse } = await supabase
    .from("open_houses")
    .select("id")
    .eq("id", openHouseId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!openHouse) return [];

  const { data } = await supabase
    .from("open_house_visitors")
    .select("id, full_name, phone, email, notes, created_customer_id, registered_at")
    .eq("open_house_id", openHouseId)
    .order("registered_at", { ascending: false });

  return data ?? [];
}

/** Tek bir acik ev kaydi (detay sayfasi icin). */
/** Açık ev etkinliğini düzenler (tarih/saat, süre, konum, kapasite, not). Biten/iptal edilen düzenlenemez. */
export async function updateOpenHouse(
  openHouseId: string,
  fd: FormData,
): Promise<OpenHouseResult> {
  const gate = await requirePermission("open_house", "edit");
  if (!gate.ok) return { error: gate.error };

  const scheduledAt = String(fd.get("scheduled_at") ?? "").trim();
  const durationMin = parseInt(String(fd.get("duration_min") ?? "120"));
  const location = String(fd.get("location") ?? "").trim() || null;
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const maxVisitors = parseInt(String(fd.get("max_visitors") ?? "0")) || null;

  if (!scheduledAt) return { error: "Tarih/saat zorunludur." };
  const scheduledDate = parseTrLocalDateTime(scheduledAt);
  if (!scheduledDate) return { error: "Geçerli bir tarih/saat girin." };
  if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 1_440) {
    return { error: "Süre 15-1440 dakika arasında olmalıdır." };
  }
  if (maxVisitors != null && (!Number.isInteger(maxVisitors) || maxVisitors < 1 || maxVisitors > 10_000)) {
    return { error: "Ziyaretçi kapasitesi 1-10000 arasında olmalıdır." };
  }
  if (location && location.length > 500) return { error: "Konum en fazla 500 karakter olabilir." };
  if (notes && notes.length > 5000) return { error: "Not en fazla 5000 karakter olabilir." };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("open_houses")
    .select("status, visitor_count")
    .eq("id", openHouseId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!current) return { error: "Açık ev etkinliği bulunamadı." };
  if (current.status === "completed" || current.status === "cancelled") {
    return { error: "Tamamlanan ya da iptal edilen etkinlik düzenlenemez." };
  }
  if (maxVisitors != null && (current.visitor_count ?? 0) > maxVisitors) {
    return { error: `Kapasite mevcut ziyaretçi sayısından (${current.visitor_count}) küçük olamaz.` };
  }

  const { error } = await supabase
    .from("open_houses")
    .update({
      scheduled_at: scheduledDate.toISOString(),
      duration_min: durationMin,
      location,
      notes,
      max_visitors: maxVisitors,
    })
    .eq("id", openHouseId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Açık ev güncellenemedi.") };

  revalidatePath("/app/acik-ev");
  revalidatePath(`/app/acik-ev/${openHouseId}`);
  return { ok: true, id: openHouseId };
}

export async function getOpenHouse(openHouseId: string) {
  const gate = await requirePermission("open_house", "view");
  if (!gate.ok) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("open_houses")
    .select(
      "id, scheduled_at, duration_min, location, status, visitor_count, max_visitors, notes, created_at, public_token, property:properties!open_houses_property_id_fkey(id, property_code, title, address_line, list_price)",
    )
    .eq("id", openHouseId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  return data;
}

export async function listOpenHouses() {
  const gate = await requirePermission("open_house", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("open_houses")
    .select("id, scheduled_at, duration_min, location, status, visitor_count, max_visitors, notes, property:properties!open_houses_property_id_fkey(id, property_code, title)")
    .eq("tenant_id", gate.tenantId)
    .order("scheduled_at", { ascending: false })
    .limit(50);

  return data ?? [];
}

// ============================================================
// 10. Kaynak takibi — müşteriye lead_source kaydet
// ============================================================

export type LeadSourceResult = { ok?: boolean; error?: string };
