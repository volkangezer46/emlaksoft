"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { FOREIGN_SALE_CHECKLIST } from "@/lib/foreign-sale-checklist";

/**
 * Yabancıya satış — evrak listesi uygulama ve müşteri işaretleme action'ları.
 *
 * Ayrı dosya: `deal-checklist.ts` ve `customers.ts` başka dalgaların dosyaları,
 * onlara dokunulmadı. Kapılar hedef veriye göre ayrı seçildi — evrak listesi
 * anlaşmaya yazıldığı için "commissions" (anlaşma sayfaları bu modülle açılır),
 * müşteri işaretleme "customers".
 */

export type ForeignSaleResult = { error?: string; ok?: boolean; added?: number };

/**
 * Yabancıya satış evrak listesini seçilen anlaşmaya uygular.
 *
 * `deal-checklist.ts > createFromTemplate`'ten farkı: liste doluysa REDDETMEZ.
 * Yabancıya satış maddeleri genel satış şablonunun ÜSTÜNE biner — danışman
 * önce normal şablonu oluşturmuş olabilir. Yinelenmeyi label karşılaştırmasıyla
 * önleriz; zaten var olan maddeler atlanır, kaç madde eklendiği geri döner.
 */
export async function applyForeignChecklist(
  _prev: ForeignSaleResult,
  fd: FormData,
): Promise<ForeignSaleResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const dealId = String(fd.get("deal_id") ?? "").trim();
  if (!dealId) return { error: "Anlaşma seçilmedi." };

  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!deal) return { error: "Anlaşma bulunamadı." };

  const { data: existing } = await supabase
    .from("deal_checklist_items")
    .select("label, sort_order")
    .eq("deal_id", dealId)
    .eq("tenant_id", gate.tenantId);

  const rows = (existing ?? []) as { label: string; sort_order: number | null }[];
  const have = new Set(rows.map((r) => r.label.trim().toLocaleLowerCase("tr-TR")));
  const nextOrder = rows.reduce((max, r) => Math.max(max, r.sort_order ?? 0), -1) + 1;

  const missing = FOREIGN_SALE_CHECKLIST.filter(
    (t) => !have.has(t.label.trim().toLocaleLowerCase("tr-TR")),
  );
  if (missing.length === 0) {
    return { error: "Yabancıya satış maddeleri bu anlaşmada zaten ekli." };
  }

  const { error } = await supabase.from("deal_checklist_items").insert(
    missing.map((t, i) => ({
      tenant_id: gate.tenantId,
      deal_id: dealId,
      label: t.label,
      is_required: t.required,
      sort_order: nextOrder + i,
    })),
  );
  if (error) {
    console.error("applyForeignChecklist", error);
    return { error: "Evrak listesi eklenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.checklist.foreign",
    entityType: "deal",
    entityId: dealId,
    newValue: { item_count: missing.length },
  });

  revalidatePath(`/app/anlasmalar/${dealId}`);
  revalidatePath("/app/yabanci-satis");
  return { ok: true, added: missing.length };
}

/**
 * Müşteriyi yabancı uyruklu olarak işaretler (uyruk/pasaport opsiyonel).
 *
 * `is_foreign=false` gönderilerek işaret kaldırılabilir; bu durumda uyruk ve
 * pasaport alanları KORUNUR — yanlışlıkla kaldırılan işaret geri açıldığında
 * veri kaybolmasın diye bilinçli tercih.
 */
export async function markCustomerForeign(
  _prev: ForeignSaleResult,
  fd: FormData,
): Promise<ForeignSaleResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(fd.get("customer_id") ?? "").trim();
  if (!customerId) return { error: "Müşteri seçilmedi." };

  const isForeign = String(fd.get("is_foreign") ?? "1") !== "0";
  const nationality = String(fd.get("nationality") ?? "").trim();
  const passportNo = String(fd.get("passport_no") ?? "").trim();
  if (nationality.length > 80) return { error: "Uyruk en fazla 80 karakter olabilir." };
  if (passportNo.length > 40) return { error: "Pasaport numarası en fazla 40 karakter olabilir." };

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("id, full_name")
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!customer) return { error: "Müşteri bulunamadı." };

  const patch: Record<string, unknown> = { is_foreign: isForeign };
  if (isForeign) {
    if (nationality) patch.nationality = nationality;
    if (passportNo) patch.passport_no = passportNo;
  }

  const { error } = await supabase
    .from("customers")
    .update(patch)
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("markCustomerForeign", error);
    return { error: "Müşteri güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: isForeign ? "customer.foreign.mark" : "customer.foreign.unmark",
    entityType: "customer",
    entityId: customerId,
    newValue: { is_foreign: isForeign, nationality: nationality || null },
  });

  revalidatePath("/app/yabanci-satis");
  revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true };
}
