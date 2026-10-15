"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { updateAppointmentStatus } from "@/app/actions/appointments";
import { POST_CLOSE_LIST_LIMIT } from "@/lib/post-close-model";
import { OPEN_DEMAND_STATUSES, isIsoDate, type AppointmentStatus, type DemandStatus } from "@/lib/workflow-state";

/**
 * Kapanış sonrası temizliğin kullanıcı eylemleri (kapanış sihirbazındaki özet kartı):
 *  - `undoPostCloseCleanup`: otomatik kapatılan talepleri önceki durumuna, bu işlemle yazılan yıldönümünü boşa döndürür.
 *  - `cancelPostCloseAppointments`: portföyde kalan randevuları tek tıkla iptal eder (her biri randevu durum
 *    geçişinden geçer). Teklifler için mevcut `bulkUpdateOfferStatus(ids, "rejected")` kullanılır.
 * Her eylem kendi modül iznini ister; satırlar ofis (tenant) süzgeciyle güncellenir.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UndoPostCloseInput = {
  dealId: string;
  closedDemands: { id: string; previousStatus: string }[];
  anniversary: { customerId: string; date: string; note: string } | null;
};

export type UndoPostCloseResult = { ok?: boolean; error?: string; restoredDemands?: number; anniversaryCleared?: boolean };

export async function undoPostCloseCleanup(input: UndoPostCloseInput): Promise<UndoPostCloseResult> {
  const dealId = String(input?.dealId ?? "");
  if (!UUID.test(dealId)) return { error: "Anlaşma bulunamadı." };
  const open = new Set<string>(OPEN_DEMAND_STATUSES);
  const demands = (Array.isArray(input?.closedDemands) ? input.closedDemands : [])
    .filter((d) => d && UUID.test(String(d.id)) && open.has(String(d.previousStatus)))
    .slice(0, POST_CLOSE_LIST_LIMIT * 2);
  const ann = input?.anniversary && UUID.test(String(input.anniversary.customerId)) && isIsoDate(String(input.anniversary.date))
    ? input.anniversary
    : null;
  if (demands.length === 0 && !ann) return { error: "Geri alınacak değişiklik yok." };

  // Yetki: her değişiklik kendi modülünün düzenleme izniyle geri alınır (ikisi de yoksa hiçbir şey yazılmaz).
  const demandGate = demands.length > 0 ? await requirePermission("demands", "edit") : null;
  if (demandGate && !demandGate.ok) return { error: demandGate.error };
  const customerGate = ann ? await requirePermission("customers", "edit") : null;
  if (customerGate && !customerGate.ok) return { error: customerGate.error };
  const gate = demandGate ?? customerGate;
  if (!gate?.ok) return { error: "Yetkiniz yok." };

  const supabase = await createClient();
  let restoredDemands = 0;
  const byStatus = new Map<string, string[]>();
  for (const d of demands) byStatus.set(d.previousStatus, [...(byStatus.get(d.previousStatus) ?? []), d.id]);
  for (const [status, ids] of byStatus) {
    // Yalnız hâlâ "closed" olan talep döner: arada elle değiştirilen talebin üstüne yazılmaz.
    const { data, error } = await supabase
      .from("customer_demands")
      .update({ status: status as DemandStatus })
      .in("id", ids)
      .eq("tenant_id", gate.tenantId)
      .eq("status", "closed" satisfies DemandStatus)
      .select("id");
    if (error) {
      console.error("undoPostCloseCleanup demands", error);
      return { error: actionErrorMessage(error, "Talepler eski durumuna döndürülemedi.") };
    }
    restoredDemands += (data ?? []).length;
  }

  let anniversaryCleared = false;
  if (ann) {
    // Yalnız bu kapanışın yazdığı değer (aynı tarih + not) silinir; sonradan elle girilen yıldönümü korunur.
    const { data, error } = await supabase
      .from("customers")
      .update({ anniversary_date: null, anniversary_note: null })
      .eq("id", ann.customerId)
      .eq("tenant_id", gate.tenantId)
      .eq("anniversary_date", ann.date)
      .eq("anniversary_note", String(ann.note))
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("undoPostCloseCleanup anniversary", error);
      return { error: actionErrorMessage(error, "Yıldönümü geri alınamadı."), restoredDemands };
    }
    anniversaryCleared = Boolean(data);
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.post_close_undo",
    entityType: "deal",
    entityId: dealId,
    newValue: {
      restored_demand_ids: demands.map((d) => d.id),
      restored_count: restoredDemands,
      anniversary_cleared: anniversaryCleared,
    },
  });

  revalidatePath("/app/talepler");
  if (ann) revalidatePath(`/app/musteriler/${ann.customerId}`);
  revalidatePath("/app/musteriler");
  revalidateTenantData(gate.tenantId);
  return { ok: true, restoredDemands, anniversaryCleared };
}

export type CancelAppointmentsResult = { error?: string; updated?: number; failed?: number; firstError?: string };

/** Satılan/kiralanan portföyün kalan randevularını iptal eder; her randevu durum geçiş kuralından geçer. */
export async function cancelPostCloseAppointments(ids: string[]): Promise<CancelAppointmentsResult> {
  const gate = await requirePermission("appointments", "edit");
  if (!gate.ok) return { error: gate.error };
  const list = Array.isArray(ids)
    ? [...new Set(ids.map((v) => String(v)).filter((v) => UUID.test(v)))].slice(0, POST_CLOSE_LIST_LIMIT)
    : [];
  if (list.length === 0) return { error: "Randevu seçin." };
  let updated = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const id of list) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", "cancelled" satisfies AppointmentStatus);
    const res = await updateAppointmentStatus(fd);
    if (res.ok) updated += 1;
    else {
      failed += 1;
      firstError ??= res.error;
    }
  }
  return { updated, failed, firstError };
}
