"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isValidTurkishMobile, normalizeTurkishPhone } from "@/lib/phone";

const DAY = 86_400_000;

/**
 * Kayıp satış kartını listeden düşürür.
 *
 *  - reason = "called"  → "Arandı ✓": 30 gün gizlenir. "Çağrı olarak da
 *    kaydet" kutusu işaretliyse (log_call=1, varsayılan) calls tablosuna
 *    outbound + "Ulaşıldı" kaydı da atılır — müşteri zaman tüneline düşer.
 *    Kutu işaretsizse yalnız dedektör listesi temizlenir (eski davranış).
 *  - reason = "snoozed" → "1 hafta ertele": 7 gün gizlenir.
 *
 * Müşteri başına tek satır (unique tenant_id+customer_id) — tekrar basmak
 * süreyi tazeler (upsert).
 */
export async function dismissLostSaleRisk(formData: FormData): Promise<void> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return;

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!customerId || (reason !== "called" && reason !== "snoozed")) return;

  const now = new Date();
  const until = new Date(now.getTime() + (reason === "called" ? 30 : 7) * DAY).toISOString();

  const supabase = await createClient();
  const { error } = await supabase.from("lost_sale_dismissals").upsert(
    {
      tenant_id: gate.tenantId,
      customer_id: customerId,
      reason,
      dismissed_until: until,
      created_by: gate.userId,
      // Upsert'te tazelensin diye açık yazıldı: "Arandı"nın 30 günlük
      // penceresi son basıştan itibaren sayılır.
      created_at: now.toISOString(),
    },
    { onConflict: "tenant_id,customer_id" },
  );

  if (error) {
    console.error("dismissLostSaleRisk", error);
    return;
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: reason === "called" ? "lost_sale.called" : "lost_sale.snoozed",
    entityType: "customer",
    entityId: customerId,
    newValue: { reason, dismissed_until: until },
  });

  // Opsiyonel çağrı kaydı: "Arandı" + kutu işaretli + geçerli telefon.
  // Ayrı yetki kapısı (calls.create) — yoksa dismiss yine de tamamlanır,
  // yalnızca çağrı kaydı sessizce atlanır.
  const logCall = String(formData.get("log_call") ?? "") === "1";
  const rawPhone = String(formData.get("phone") ?? "").trim();
  if (reason === "called" && logCall && rawPhone && isValidTurkishMobile(rawPhone)) {
    const callGate = await requirePermission("calls", "create");
    if (callGate.ok) {
      // Değerler arama sayfasıyla aynı sözlükten: direction 'outbound'
      // (bkz. /app/arama YON_LABELS), disposition "Ulaşıldı" (CallConsole
      // dispositions listesi) — böylece filtre/KPI'larda doğru sayılır.
      const { error: callError } = await supabase.from("calls").insert({
        tenant_id: callGate.tenantId,
        customer_id: customerId,
        direction: "outbound",
        phone: normalizeTurkishPhone(rawPhone),
        disposition: "Ulaşıldı",
        notes: "Kayıp satış dedektöründen arandı.",
        handled_by: callGate.userId,
        started_at: now.toISOString(),
      });
      if (callError) {
        console.error("dismissLostSaleRisk call log", callError);
      } else {
        await logActivity({
          tenantId: callGate.tenantId,
          actorId: callGate.userId,
          action: "call.create",
          entityType: "call",
          entityId: customerId,
          newValue: { direction: "outbound", phone: normalizeTurkishPhone(rawPhone), disposition: "Ulaşıldı" },
        });
        revalidatePath("/app/arama");
        revalidatePath(`/app/musteriler/${customerId}`);
      }
    }
  }

  revalidatePath("/app/kayip-satis");
}
