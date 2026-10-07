"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { computeLegalIncreaseIn } from "@/lib/tufe";
import { loadTufeTable } from "@/lib/tufe-server";
import { triggerPlaybooks } from "@/lib/playbook-trigger";
import { parseMoneyInput } from "@/lib/money-input";
import { isIsoDate } from "@/lib/workflow-state";
import { checkRentalExtension } from "@/lib/workflow-rules";
import { actionErrorMessage } from "@/lib/action-errors";

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
  const financialGate = await requirePermission("commissions", "create");
  if (!financialGate.ok) return { error: financialGate.error };

  const propertyId  = String(fd.get("property_id") ?? "").trim();
  const renterId    = String(fd.get("renter_customer_id") ?? "").trim();
  const monthlyRentResult = parseMoneyInput(fd.get("monthly_rent"), { max: 1_000_000_000 });
  const dueDay      = parseInt(String(fd.get("due_day") ?? "0"), 10);
  const startDate   = String(fd.get("start_date") ?? "").trim();
  const endDate     = String(fd.get("end_date") ?? "").trim() || null;
  const depositResult = parseMoneyInput(fd.get("deposit"), { allowZero: true, max: 1_000_000_000 });
  const notes       = String(fd.get("notes") ?? "").trim() || null;

  if (!propertyId) return { error: "Portföy seçin." };
  if (!renterId) return { error: "Kiracı (müşteri) seçin." };
  if (!monthlyRentResult.ok || monthlyRentResult.value == null) return { error: "Geçerli bir aylık kira tutarı girin." };
  if (isNaN(dueDay) || dueDay < 1 || dueDay > 28) return { error: "Vade günü 1-28 arasında olmalı." };
  if (!startDate || !isIsoDate(startDate)) return { error: "Geçerli bir başlangıç tarihi girin." };
  if (endDate && !isIsoDate(endDate)) return { error: "Geçerli bir bitiş tarihi girin." };
  if (endDate && endDate <= startDate) return { error: "Bitiş tarihi başlangıçtan sonra olmalı." };
  if (!depositResult.ok) return { error: "Geçerli bir depozito tutarı girin." };
  if (notes && notes.length > 5000) return { error: "Not en fazla 5000 karakter olabilir." };
  const monthlyRent = monthlyRentResult.value;
  const deposit = depositResult.value;

  const admin = createAdminClient();
  const { data: transitionData, error } = await admin.rpc("create_rental_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_property_id: propertyId,
    p_renter_id: renterId,
    p_monthly_rent: monthlyRent,
    p_due_day: dueDay,
    p_start_date: startDate,
    p_end_date: endDate,
    p_deposit: deposit,
    p_notes: notes,
  });
  if (error) {
    console.error("createRental atomic", { code: error.code });
    return { error: actionErrorMessage(error, "Kira, portföy ve kiracı kaydı birlikte oluşturulamadı.") };
  }
  const transition = transitionData && typeof transitionData === "object" && !Array.isArray(transitionData)
    ? transitionData as Record<string, unknown>
    : null;
  if (transition?.outcome === "property_not_found") return { error: "Portföy bulunamadı." };
  if (transition?.outcome === "renter_not_found") return { error: "Kiracı (müşteri) bulunamadı." };
  if (transition?.outcome === "property_unavailable") return { error: "Portföy satılmış, kiralanmış veya aktif kiraya bağlı." };
  if (transition?.outcome === "commission_rate_required") {
    return { error: "Kiralama kapanışından önce portföyde 0'dan büyük, en çok iki ondalık haneli geçerli bir komisyon oranı tanımlayın." };
  }
  if (transition?.outcome !== "created" || typeof transition.rental_id !== "string") {
    return { error: actionErrorMessage(null, "Kira kaydı oluşturulamadı.") };
  }
  const rentalId = transition.rental_id;

  // İş akışı (playbook) tetikle — sözleşme/depozito/anahtar teslim paketi
  await triggerPlaybooks({
    tenantId: gate.tenantId,
    event: "kira_sozlesmesi",
    actorId: gate.userId,
    entity: {
      type: "contract",
      id: rentalId,
      ownerId: gate.userId,
      customerId: renterId,
      propertyId,
      fields: {},
    },
  });

  revalidatePath("/app/kiralama");
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, id: rentalId };
}

/** Kirayı sonlandırır — end_date boşsa bugünle doldurulur (geçmiş kayıt korunur). */
export async function endRental(id: string): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("end_rental_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_rental_id: id,
    p_end_date: new Date().toISOString().slice(0, 10),
  });
  if (error) {
    console.error("endRental atomic", { code: error.code });
    return { error: "Kira ve portföy durumu birlikte sonlandırılamadı." };
  }
  const transition = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  const outcome = typeof transition?.outcome === "string" ? transition.outcome : "invalid_result";
  if (outcome === "not_found") return { error: "Kira kaydı bulunamadı." };
  if (outcome === "invalid_end_date") return { error: "Sonlandırma tarihi başlangıçtan önce olamaz." };
  if (outcome !== "applied" && outcome !== "replay") return { error: "Kira sonlandırılamadı." };

  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${id}`);
  revalidatePath("/app/portfoyler");
  if (typeof transition?.property_id === "string") {
    revalidatePath(`/app/portfoyler/${transition.property_id}`);
  }
  return { ok: true };
}

/**
 * Kira sözleşmesi düzenleme (P0-5): vade günü, bitiş tarihi, depozito ve not.
 * Aylık tutar `applyRentIncrease` ile, durum `endRental` ile değişir (atomik akışlar).
 * Tahakkuk cron'una dokunulmaz; o her gün güncel `rentals` satırını okur — bitiş uzatılınca
 * ve vade günü değişince sonraki tahakkuklar kendiliğinden doğru üretilir.
 */
export async function updateRental(_prev: RentalResult, fd: FormData): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("rental_id") ?? "").trim();
  if (!id) return { error: "Kira kaydı bulunamadı." };
  const dueDay = parseInt(String(fd.get("due_day") ?? "0"), 10);
  const endDate = String(fd.get("end_date") ?? "").trim() || null;
  const depositResult = parseMoneyInput(fd.get("deposit"), { allowZero: true, max: 1_000_000_000 });
  const notes = String(fd.get("notes") ?? "").trim() || null;

  if (isNaN(dueDay) || dueDay < 1 || dueDay > 28) return { error: "Vade günü 1-28 arasında olmalı." };
  if (endDate && !isIsoDate(endDate)) return { error: "Geçerli bir bitiş tarihi girin." };
  if (!depositResult.ok) return { error: "Geçerli bir depozito tutarı girin." };
  if (notes && notes.length > 5000) return { error: "Not en fazla 5000 karakter olabilir." };

  const supabase = await createClient();
  const { data: rental } = await supabase
    .from("rentals")
    .select("id, status, start_date, due_day, end_date, deposit, notes")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };
  if (rental.status !== "active") return { error: "Yalnızca aktif kira kaydı düzenlenebilir." };
  if (endDate && endDate <= String(rental.start_date)) return { error: "Bitiş tarihi başlangıçtan sonra olmalı." };

  const patch = { due_day: dueDay, end_date: endDate, deposit: depositResult.value, notes };
  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("rentals")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("updateRental", error);
    return { error: actionErrorMessage(error, "Kira kaydı güncellenemedi.") };
  }
  if (!updated) return { error: "Kira kaydı bu sırada değişti; sayfayı yenileyin." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "rental.update",
    entityType: "rental",
    entityId: id,
    oldValue: { due_day: rental.due_day, end_date: rental.end_date, deposit: rental.deposit },
    newValue: { due_day: dueDay, end_date: endDate, deposit: depositResult.value },
  });
  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${id}`);
  return { ok: true, id };
}

/**
 * Kira sözleşmesini uzatır / yeniler (P0-5): yeni bitiş tarihi mevcut bitişten sonra olmalı;
 * boş bırakılırsa sözleşme süresiz olur. Opsiyonel `monthly_rent` yalnız "artış" ise
 * `applyRentIncrease` kullanılmalıdır; burada tutar değişmez.
 */
export async function extendRental(id: string, newEndDate: string | null): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (newEndDate && !isIsoDate(newEndDate)) return { error: "Geçerli bir bitiş tarihi girin." };

  const supabase = await createClient();
  const { data: rental } = await supabase
    .from("rentals")
    .select("id, status, start_date, end_date")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };
  const check = checkRentalExtension({
    status: String(rental.status),
    startDate: String(rental.start_date).slice(0, 10),
    currentEnd: rental.end_date ? String(rental.end_date).slice(0, 10) : null,
    newEnd: newEndDate,
  });
  if (!check.ok) return { error: check.error };
  if (check.noop) return { ok: true, id };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("rentals")
    .update({ end_date: newEndDate })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("extendRental", error);
    return { error: "Kira uzatılamadı." };
  }
  if (!updated) return { error: "Kira kaydı bu sırada değişti; sayfayı yenileyin." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "rental.extend",
    entityType: "rental",
    entityId: id,
    oldValue: { end_date: rental.end_date },
    newValue: { end_date: newEndDate },
  });
  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${id}`);
  return { ok: true, id };
}

/** Depozito iadesi işaretle (C.3) — kira bitince depozitonun kiracıya iade
 *  edildiğini kaydeder. Geri almak için `returned=false` gönderilebilir. */
export async function markDepositReturned(id: string, returned = true): Promise<RentalResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: rental, error: loadError } = await supabase
    .from("rentals")
    .select("id, status, deposit, deposit_returned")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (loadError || !rental) return { error: "Kira kaydı bulunamadı." };
  if (returned && rental.status !== "ended") return { error: "Depozito yalnız kira sonlandıktan sonra iade edilebilir." };
  if (returned && Number(rental.deposit) <= 0) return { error: "Bu kira kaydında iade edilecek depozito yok." };
  if (rental.deposit_returned === returned) return { ok: true };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rentals")
    .update({
      deposit_returned: returned,
      deposit_returned_at: returned ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", rental.status)
    .eq("deposit_returned", !returned)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("markDepositReturned", error);
    return { error: actionErrorMessage(error, "Depozito durumu güncellenemedi.") };
  }
  if (!data) return { error: "Depozito durumu bu sırada değişti; sayfayı yenileyin." };

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
    .select("id, monthly_rent, status, start_date, end_date")
    .eq("id", rentalId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!rental) return { error: "Kira kaydı bulunamadı." };
  const period = `${month}-01`;
  if (period < String(rental.start_date).slice(0, 7) + "-01") {
    return { error: "Kira başlangıcından önce tahakkuk oluşturulamaz." };
  }
  if (rental.end_date && period > String(rental.end_date).slice(0, 7) + "-01") {
    return { error: "Kira bitişinden sonraki dönem için tahakkuk oluşturulamaz." };
  }
  if (rental.status !== "active" && !rental.end_date) {
    return { error: "Sonlanmış kira için yeni tahakkuk oluşturulamaz." };
  }

  const { data, error } = await supabase
    .from("rent_charges")
    .insert({
      tenant_id: gate.tenantId,
      rental_id: rentalId,
      period,
      amount: rental.monthly_rent,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Bu dönem için tahakkuk zaten var." };
    console.error("createRentCharge", error);
    return { error: actionErrorMessage(error, "Tahakkuk oluşturulamadı.") };
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
  const { data, error } = await supabase
    .from("rent_charges")
    .update({ status: paid ? "paid" : "pending", paid_at: paid ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("rental_id", rentalId)
    .neq("status", paid ? "paid" : "pending")
    .select("id")
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Tahakkuk durumu güncellenemedi.") };
  if (!data) return { error: "Tahakkuk bulunamadı veya durum zaten güncel." };

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

  const rentResult = parseMoneyInput(newRent, { max: 1_000_000_000 });
  if (!rentResult.ok || rentResult.value == null) return { error: "Geçerli, en çok iki ondalık haneli bir yeni kira tutarı girin." };
  const validatedNewRent = rentResult.value;
  if (!TARIH_RE.test(effectiveDate) || !isIsoDate(effectiveDate)) return { error: "Geçerli bir uygulama tarihi seçin." };

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
  if (validatedNewRent <= currentRent) return { error: "Yeni kira mevcut kiradan yüksek olmalı." };

  // Yasal tavan (TBK m.344): uygulama ayının 12 aylık ort. TÜFE'si — sunucu tarafında da kesilir.
  // ANCAK yalnız RESMİ veri olan aylarda: resmi olmayan (ör. 2026) ayda oran
  // eski aya düşen tahmindir; onu "yasal tavan" diye dayatmak yasal-üstü bir
  // artışa izin verir (gerçek 2026 tavanı daha düşük olabilir). Bu aylarda tavan
  // KESİLMEZ — sorumluluk, resmi oranı bilen kullanıcıdadır; denetim kaydına da
  // uydurma "TÜFE %X" yazılmaz.
  const legal = computeLegalIncreaseIn(await loadTufeTable(), currentRent, effectiveDate.slice(0, 7));
  if (legal.official && validatedNewRent > legal.newRent) {
    return {
      error: `Yeni kira yasal tavanı aşıyor — TÜFE %${legal.appliedRate.toFixed(2)} ile en fazla ${new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(legal.newRent)} olabilir.`,
    };
  }

  const para = (n: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
  const tarih = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${effectiveDate}T00:00:00`));
  const oranNotu = legal.official ? `TÜFE %${legal.appliedRate.toFixed(2)}` : "manuel oran (resmi TÜFE bekleniyor)";
  const izSatiri = `Kira artışı: ${para(currentRent)} → ${para(validatedNewRent)}, ${oranNotu}, ${tarih}`;
  const notes = rental.notes ? `${rental.notes}\n${izSatiri}` : izSatiri;

  const admin = createAdminClient();
  const updateBase = admin
    .from("rentals")
    .update({ monthly_rent: validatedNewRent, notes })
    .eq("id", rentalId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "active")
    .eq("monthly_rent", rental.monthly_rent);
  const updateQuery = rental.notes == null
    ? updateBase.is("notes", null)
    : updateBase.eq("notes", rental.notes);
  const { data: updated, error } = await updateQuery.select("id").maybeSingle();
  if (error) {
    console.error("applyRentIncrease", error);
    return { error: actionErrorMessage(error, "Kira artışı uygulanamadı.") };
  }
  if (!updated) return { error: "Kira kaydı bu sırada değişti; sayfayı yenileyip tekrar deneyin." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "rental.rent_increase",
    entityType: "rental",
    entityId: rentalId,
    oldValue: { monthly_rent: currentRent },
    newValue: { monthly_rent: validatedNewRent, effective_date: effectiveDate, tufe_rate: legal.appliedRate },
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
    return { error: actionErrorMessage(error, "Bakım talebi kaydedilemedi.") };
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
  if (error) return { error: actionErrorMessage(error, "Bakım talebi güncellenemedi.") };

  revalidatePath("/app/kiralama");
  revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true };
}
