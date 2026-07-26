"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { computeLegalIncrease } from "@/lib/tufe";

/**
 * Mülk Yönetimi (kiralama) server action'ları.
 *
 * Kiracı = mevcut `customers` kaydı — yeni kişi tablosu yok. Kira kaydı
 * açılırken müşteri 'Kiracı' tip etiketiyle işaretlenir (customer_types
 * dizisine eklenir; definitions seed'indeki değerle birebir).
 *
 * Tahakkuklar (`rent_charges`) iki yoldan doğar: /api/cron/kira-tahakkuk
 * (aylık otomatik) ve buradaki `createRentCharge` (manuel "Dönem tahakkuku
 * oluştur"). unique(rental_id, period) mükerrer dönemi DB seviyesinde keser.
 */

export type RentalResult = { ok?: boolean; error?: string; id?: string };

const AY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function createRental(_prev: RentalResult, fd: FormData): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId  = String(fd.get("property_id") ?? "").trim();
  const renterId    = String(fd.get("renter_customer_id") ?? "").trim();
  const monthlyRent = parseFloat(String(fd.get("monthly_rent") ?? "0"));
  const dueDay      = parseInt(String(fd.get("due_day") ?? "0"), 10);
  const startDate   = String(fd.get("start_date") ?? "").trim();
  const endDate     = String(fd.get("end_date") ?? "").trim() || null;
  const depositRaw  = String(fd.get("deposit") ?? "").trim();
  const deposit     = depositRaw ? parseFloat(depositRaw) : null;
  const notes       = String(fd.get("notes") ?? "").trim() || null;

  if (!propertyId) return { error: "Portföy seçin." };
  if (!renterId) return { error: "Kiracı (müşteri) seçin." };
  if (isNaN(monthlyRent) || monthlyRent <= 0) return { error: "Geçerli bir aylık kira tutarı girin." };
  if (isNaN(dueDay) || dueDay < 1 || dueDay > 28) return { error: "Vade günü 1-28 arasında olmalı." };
  if (!startDate) return { error: "Başlangıç tarihi zorunludur." };
  if (endDate && endDate <= startDate) return { error: "Bitiş tarihi başlangıçtan sonra olmalı." };
  if (deposit != null && (isNaN(deposit) || deposit < 0)) return { error: "Geçerli bir depozito tutarı girin." };

  const supabase = await createClient();

  // Tenant izolasyonu: FK tek başına başka ofisin portföy/müşteri id'sine
  // referansı engellemez — ikisi de bu ofise ait olmalı.
  const [{ data: prop }, { data: renter }] = await Promise.all([
    supabase.from("properties").select("id").eq("id", propertyId).eq("tenant_id", gate.tenantId).maybeSingle(),
    supabase.from("customers").select("id").eq("id", renterId).eq("tenant_id", gate.tenantId).maybeSingle(),
  ]);
  if (!prop) return { error: "Portföy bulunamadı." };
  if (!renter) return { error: "Kiracı (müşteri) bulunamadı." };

  const { data, error } = await supabase
    .from("rentals")
    .insert({
      tenant_id: gate.tenantId,
      created_by: gate.userId,
      property_id: propertyId,
      renter_customer_id: renterId,
      monthly_rent: monthlyRent,
      due_day: dueDay,
      start_date: startDate,
      end_date: endDate,
      deposit,
      notes,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createRental", error);
    return { error: "Kira kaydı oluşturulamadı." };
  }

  // Kiracıyı tip etiketiyle işaretle — best effort: başarısızlığı kira
  // kaydını düşürmez (etiket kozmetik, kayıt esas).
  try {
    const { data: cust } = await supabase
      .from("customers")
      .select("customer_types")
      .eq("id", renterId)
      .maybeSingle();
    const types: string[] = Array.isArray(cust?.customer_types) ? cust!.customer_types : [];
    if (!types.includes("Kiracı")) {
      await supabase
        .from("customers")
        .update({ customer_types: [...types, "Kiracı"] })
        .eq("id", renterId);
    }
  } catch (e) {
    console.error("createRental kiracı etiketi", e);
  }

  revalidatePath("/app/kiralama");
  return { ok: true, id: data.id };
}

/** Kirayı sonlandırır — end_date boşsa bugünle doldurulur (geçmiş kayıt korunur). */
export async function endRental(id: string): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: rental } = await supabase
    .from("rentals")
    .select("id, end_date")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };

  const { error } = await supabase
    .from("rentals")
    .update({ status: "ended", end_date: rental.end_date ?? new Date().toISOString().slice(0, 10) })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Kira sonlandırılamadı." };

  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${id}`);
  return { ok: true };
}

/**
 * Manuel dönem tahakkuku — ay `YYYY-MM` biçiminde gelir, dönem ayın 1'i olarak
 * yazılır. Aynı dönem ikinci kez istenirse unique kısıtı yakalanıp Türkçe
 * anlatılır.
 */
export async function createRentCharge(rentalId: string, month: string): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "create");
  if (!gate.ok) return { error: gate.error };
  if (!AY_RE.test(month)) return { error: "Geçerli bir dönem (ay) seçin." };

  const supabase = await createClient();
  const { data: rental } = await supabase
    .from("rentals")
    .select("id, monthly_rent")
    .eq("id", rentalId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };

  const { data, error } = await supabase
    .from("rent_charges")
    .insert({
      tenant_id: gate.tenantId,
      rental_id: rentalId,
      period: `${month}-01`,
      amount: rental.monthly_rent,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Bu dönem için tahakkuk zaten var." };
    console.error("createRentCharge", error);
    return { error: "Tahakkuk oluşturulamadı." };
  }

  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true, id: data?.id };
}

/** Tahakkuku ödendi işaretler / geri alır. Geri alınan kayıt 'pending'e döner (cron gerekirse yeniden 'overdue' yapar). */
export async function toggleChargePaid(id: string, rentalId: string, paid: boolean): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("rent_charges")
    .update({ status: paid ? "paid" : "pending", paid_at: paid ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Tahakkuk durumu güncellenemedi." };

  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true };
}

const TARIH_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * TÜFE tavanlı kira artışını uygular — yenileme radarındaki "Artışı uygula" akışı.
 *
 * monthly_rent güncellenir + notlara iz satırı düşülür + audit log yazılır.
 * Mevcut 'pending' tahakkuklara DOKUNULMAZ: cron ve manuel tahakkuk zaten
 * güncel monthly_rent'ten ürettiği için bundan sonraki dönemler otomatik
 * yeni tutardan doğar.
 */
export async function applyRentIncrease(
  rentalId: string,
  newRent: number,
  effectiveDate: string,
): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };

  if (isNaN(newRent) || newRent <= 0) return { error: "Geçerli bir yeni kira tutarı girin." };
  if (!TARIH_RE.test(effectiveDate)) return { error: "Geçerli bir uygulama tarihi seçin." };

  const supabase = await createClient();
  const { data: rental } = await supabase
    .from("rentals")
    .select("id, monthly_rent, notes, status")
    .eq("id", rentalId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };
  if (rental.status !== "active") return { error: "Yalnızca aktif kira kayıtlarına artış uygulanabilir." };

  const currentRent = Number(rental.monthly_rent);
  if (newRent <= currentRent) return { error: "Yeni kira mevcut kiradan yüksek olmalı." };

  // Yasal tavan (TBK m.344): uygulama ayının 12 aylık ort. TÜFE'si — sunucu tarafında da kesilir.
  const legal = computeLegalIncrease(currentRent, effectiveDate.slice(0, 7));
  if (newRent > legal.newRent) {
    return {
      error: `Yeni kira yasal tavanı aşıyor — TÜFE %${legal.appliedRate.toFixed(2)} ile en fazla ${new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(legal.newRent)} olabilir.`,
    };
  }

  const para = (n: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
  const tarih = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${effectiveDate}T00:00:00`));
  const izSatiri = `Kira artışı: ${para(currentRent)} → ${para(newRent)}, TÜFE %${legal.appliedRate.toFixed(2)}, ${tarih}`;
  const notes = rental.notes ? `${rental.notes}\n${izSatiri}` : izSatiri;

  const { error } = await supabase
    .from("rentals")
    .update({ monthly_rent: newRent, notes })
    .eq("id", rentalId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("applyRentIncrease", error);
    return { error: "Kira artışı uygulanamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "rental.rent_increase",
    entityType: "rental",
    entityId: rentalId,
    oldValue: { monthly_rent: currentRent },
    newValue: { monthly_rent: newRent, effective_date: effectiveDate, tufe_rate: legal.appliedRate },
  });

  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true };
}

export async function createMaintenanceRequest(_prev: RentalResult, fd: FormData): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "create");
  if (!gate.ok) return { error: gate.error };

  const rentalId    = String(fd.get("rental_id") ?? "").trim();
  const title       = String(fd.get("title") ?? "").trim();
  const description = String(fd.get("description") ?? "").trim() || null;

  if (!rentalId) return { error: "Kira kaydı bulunamadı." };
  if (!title) return { error: "Başlık zorunludur." };

  const supabase = await createClient();

  // Tenant izolasyonu: kira kaydı bu ofise ait olmalı
  const { data: rental } = await supabase
    .from("rentals")
    .select("id")
    .eq("id", rentalId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };

  const { data, error } = await supabase
    .from("maintenance_requests")
    .insert({
      tenant_id: gate.tenantId,
      rental_id: rentalId,
      created_by: gate.userId,
      title,
      description,
      status: "open",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createMaintenanceRequest", error);
    return { error: "Bakım talebi kaydedilemedi." };
  }

  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true, id: data.id };
}

const MAINT_STATUSES = ["open", "in_progress", "done"] as const;
type MaintStatus = (typeof MAINT_STATUSES)[number];

/** Bakım talebinin durumunu ve/veya maliyetini günceller. */
export async function updateMaintenanceRequest(
  id: string,
  rentalId: string,
  patch: { status?: string; cost?: number | null },
): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };

  const update: { status?: MaintStatus; cost?: number | null } = {};
  if (patch.status !== undefined) {
    if (!MAINT_STATUSES.includes(patch.status as MaintStatus)) return { error: "Geçersiz durum." };
    update.status = patch.status as MaintStatus;
  }
  if (patch.cost !== undefined) {
    if (patch.cost != null && (isNaN(patch.cost) || patch.cost < 0)) return { error: "Geçerli bir maliyet girin." };
    update.cost = patch.cost;
  }
  if (Object.keys(update).length === 0) return { error: "Güncellenecek alan yok." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_requests")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Bakım talebi güncellenemedi." };

  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true };
}
