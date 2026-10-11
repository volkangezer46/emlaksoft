"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { daysAgoIso, now, trDayKey } from "@/lib/clock";
import { recordRentPayment } from "@/app/actions/rental-finance";
import { getDistricts } from "@/lib/geo/reader";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * Portaldan gelen isteklerin DANIŞMAN kararı. Portal doğrudan yazmaz (20261012000200): arayış güncelleme isteği
 * onaylanınca talep burada güncellenir; kiracının "Ödedim" bildirimi teyit edilince tahsilat burada kaydedilir.
 * Tümü JWT kimliğiyle (service_role YOK); satır önce "bekliyor -> karar" olarak sahiplenilir (çift tıklama tek sonuç).
 */

export type ReviewResult = { ok?: boolean; error?: string; info?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Arayış güncelleme isteğini onayla (talebi günceller) ya da reddet (talep değişmez). */
export async function decideDemandUpdate(id: string, decision: "approve" | "reject"): Promise<ReviewResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id) || (decision !== "approve" && decision !== "reject")) return { error: "İstek bulunamadı." };

  const supabase = await createClient();
  const nowIso = daysAgoIso(0);
  // Sahiplen: yalnız bekleyen istek kararlanır (yarış durumunda ikinci tıklama "zaten karara bağlanmış" alır).
  const { data: claimed, error: claimErr } = await supabase
    .from("portal_demand_updates")
    .update({ status: decision === "approve" ? "approved" : "rejected", decided_by: gate.userId, decided_at: nowIso })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id, customer_id, demand_id, budget_min, budget_max, rooms, area_text")
    .maybeSingle();
  if (claimErr) {
    return { error: actionErrorMessage(claimErr, "İstek karara bağlanamadı") };
  }
  if (!claimed) return { error: "Bu istek zaten karara bağlanmış ya da bulunamadı." };

  let info: string | undefined;
  if (decision === "approve") {
    const { data: demand } = await supabase
      .from("customer_demands")
      .select("id, province_id")
      .eq("id", claimed.demand_id as string)
      .eq("tenant_id", gate.tenantId)
      .eq("customer_id", claimed.customer_id as string)
      .maybeSingle();
    const patch: Record<string, unknown> = {};
    if (claimed.budget_min != null) patch.budget_min = Number(claimed.budget_min);
    if (claimed.budget_max != null) patch.budget_max = Number(claimed.budget_max);
    if (claimed.rooms) patch.rooms = String(claimed.rooms);
    const area = String(claimed.area_text ?? "").trim();
    if (area && demand?.province_id) {
      // Bölge serbest metin: yalnız ofisin ilindeki TEK ve kesin ilçe adı eşleşirse uygulanır; aksi halde danışman elle işler.
      const want = area.toLocaleLowerCase("tr-TR");
      const districts = (await getDistricts(demand.province_id as string)).filter((x) => x.name.toLocaleLowerCase("tr-TR") === want);
      if (districts.length === 1) patch.district_id = districts[0]!.id;
      else info = `Bölge isteği ("${area}") otomatik uygulanamadı; talepte ilçeyi elle güncelleyin.`;
    } else if (area) {
      info = `Bölge isteği ("${area}") otomatik uygulanamadı; talepte bölgeyi elle güncelleyin.`;
    }
    if (!demand || Object.keys(patch).length === 0) {
      // Uygulanacak alan yok ya da talep kalmamış: kararı geri al ki kayıtta "onaylandı ama işlenmedi" kalmasın.
      await supabase.from("portal_demand_updates").update({ status: "pending", decided_by: null, decided_at: null }).eq("id", id).eq("tenant_id", gate.tenantId);
      return { error: !demand ? "Talep bulunamadı." : "Uygulanacak değişiklik yok; isteği reddedin." };
    }
    const { error: updErr } = await supabase
      .from("customer_demands")
      .update(patch)
      .eq("id", claimed.demand_id as string)
      .eq("tenant_id", gate.tenantId);
    if (updErr) {
      await supabase.from("portal_demand_updates").update({ status: "pending", decided_by: null, decided_at: null }).eq("id", id).eq("tenant_id", gate.tenantId);
      return { error: actionErrorMessage(updErr, "Talep güncellenemedi") };
    }
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: decision === "approve" ? "portal_demand_update_approved" : "portal_demand_update_rejected",
    entityType: "customer_demand",
    entityId: claimed.demand_id as string,
    newValue: { update_id: id },
  });
  revalidatePath(`/app/musteriler/${claimed.customer_id as string}`);
  revalidatePath("/app/talepler");
  return { ok: true, info };
}

/**
 * Kiracının "Ödedim" bildirimini teyit et: tahsilat kaydı (makbuz no, kısmi/tam) açılır, bildirim "teyit edildi" olur.
 * `paidOn` verilmezse bugün (ekstre önerisi varsa o satırın tarihi UI'dan gelir). Yöntem Havale / EFT.
 */
export async function confirmRentNotice(input: { noticeId: string; paidOn?: string }): Promise<ReviewResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(input.noticeId)) return { error: "Bildirim bulunamadı." };

  const supabase = await createClient();
  const { data: notice } = await supabase
    .from("rent_payment_notices")
    .select("id, rental_id, charge_id, amount, status, reference")
    .eq("id", input.noticeId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!notice) return { error: "Bildirim bulunamadı." };
  if (notice.status !== "pending") return { error: "Bu bildirim zaten karara bağlanmış." };

  const paid = await recordRentPayment({
    chargeId: notice.charge_id as string,
    rentalId: notice.rental_id as string,
    amount: Number(notice.amount),
    paidOn: input.paidOn && /^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) ? input.paidOn : trDayKey(now()),
    method: "bank_transfer",
    bankNote: ["Kiracı bildirimi", notice.reference ? String(notice.reference) : ""].filter(Boolean).join(" · ").slice(0, 300),
  });
  if (!paid.ok) return { error: paid.error ?? actionErrorMessage(null, "Tahsilat kaydedilemedi") };

  const { error } = await supabase
    .from("rent_payment_notices")
    .update({ status: "confirmed", decided_by: gate.userId, decided_at: daysAgoIso(0) })
    .eq("id", input.noticeId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending");
  if (error) console.error("confirmRentNotice", { code: error.code });
  revalidatePath(`/app/kiralama/${notice.rental_id as string}`);
  return { ok: true, info: paid.info };
}

/** "Ödeme hesabımıza geçmedi": bildirimi reddet (tahakkuk değişmez). */
export async function rejectRentNotice(noticeId: string): Promise<ReviewResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(noticeId)) return { error: "Bildirim bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rent_payment_notices")
    .update({ status: "rejected", decided_by: gate.userId, decided_at: daysAgoIso(0) })
    .eq("id", noticeId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("rental_id")
    .maybeSingle();
  if (error) {
    return { error: actionErrorMessage(error, "Bildirim reddedilemedi") };
  }
  if (!data) return { error: "Bu bildirim zaten karara bağlanmış ya da bulunamadı." };
  revalidatePath(`/app/kiralama/${data.rental_id as string}`);
  return { ok: true };
}
