"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { templateForDealType } from "@/lib/deal-checklist-templates";

/**
 * Anlaşma kapanış dosyası — evrak kontrol listesi action'ları.
 *
 * Ayrı dosya (deals.ts'e dokunulmadı — paralel dalga kuralı). Modül kapısı
 * anlaşmalarla aynı: "commissions" (anlaşma sayfaları requireModulePage
 * ("commissions") ile açılıyor; ayrı bir "deals" modülü YOK).
 */

export type ChecklistResult = { error?: string; ok?: boolean };

export type ChecklistItem = {
  id: string;
  label: string;
  is_required: boolean;
  is_done: boolean;
  done_at: string | null;
  done_by_name: string | null;
  note: string | null;
  sort_order: number;
};

/** Anlaşmanın tenant'a ait olduğunu doğrular — tüm mutasyonların ön koşulu. */
async function verifyDeal(dealId: string, tenantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deals")
    .select("id, deal_type")
    .eq("id", dealId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

/**
 * Şablondan toplu oluşturma — anlaşmanın işlem türüne (sale/rent) uyan
 * varsayılan evrak listesi tek insert'le eklenir. Liste zaten doluysa
 * yinelenen dosya oluşmasın diye reddedilir.
 */
export async function createFromTemplate(_prev: ChecklistResult, fd: FormData): Promise<ChecklistResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const dealId = String(fd.get("deal_id") ?? "").trim();
  if (!dealId) return { error: "Anlaşma bulunamadı." };

  const deal = await verifyDeal(dealId, gate.tenantId);
  if (!deal) return { error: "Anlaşma bulunamadı." };

  // Tür formdan da gelebilir (türsüz anlaşmada seçtirme); yoksa anlaşmadan.
  const typeRaw = String(fd.get("deal_type") ?? "").trim();
  const dealType = typeRaw === "sale" || typeRaw === "rent" ? typeRaw : deal.deal_type;
  const template = templateForDealType(dealType);

  const supabase = await createClient();
  const { count } = await supabase
    .from("deal_checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("tenant_id", gate.tenantId);
  if ((count ?? 0) > 0) return { error: "Bu anlaşmanın evrak listesi zaten oluşturulmuş." };

  const { error } = await supabase.from("deal_checklist_items").insert(
    template.map((t, i) => ({
      tenant_id: gate.tenantId,
      deal_id: dealId,
      label: t.label,
      is_required: t.required,
      sort_order: i,
    })),
  );
  if (error) {
    console.error("createFromTemplate", error);
    return { error: "Evrak listesi oluşturulamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.checklist.template",
    entityType: "deal",
    entityId: dealId,
    newValue: { deal_type: dealType, item_count: template.length },
  });

  revalidatePath(`/app/anlasmalar/${dealId}`);
  revalidatePath("/app/anlasmalar");
  return { ok: true };
}

/** Listeye tek madde ekler — sort_order mevcutların sonuna. */
export async function addItem(_prev: ChecklistResult, fd: FormData): Promise<ChecklistResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const dealId = String(fd.get("deal_id") ?? "").trim();
  const label = String(fd.get("label") ?? "").trim();
  const isRequired = String(fd.get("is_required") ?? "") === "1";
  if (!dealId) return { error: "Anlaşma bulunamadı." };
  if (!label) return { error: "Evrak adı boş olamaz." };
  if (label.length > 200) return { error: "Evrak adı en fazla 200 karakter olabilir." };

  const deal = await verifyDeal(dealId, gate.tenantId);
  if (!deal) return { error: "Anlaşma bulunamadı." };

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("deal_checklist_items")
    .select("sort_order")
    .eq("deal_id", dealId)
    .eq("tenant_id", gate.tenantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("deal_checklist_items").insert({
    tenant_id: gate.tenantId,
    deal_id: dealId,
    label,
    is_required: isRequired,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) {
    console.error("addItem", error);
    return { error: "Madde eklenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.checklist.add",
    entityType: "deal",
    entityId: dealId,
    newValue: { label, is_required: isRequired },
  });

  revalidatePath(`/app/anlasmalar/${dealId}`);
  revalidatePath("/app/anlasmalar");
  return { ok: true };
}

/** Maddenin tamam durumunu tersine çevirir; done_at/done_by buna göre yazılır/silinir. */
export async function toggleItem(itemId: string, dealId: string): Promise<ChecklistResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("deal_checklist_items")
    .select("id, is_done, label, deal_id")
    .eq("id", itemId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!item) return { error: "Madde bulunamadı." };

  const nextDone = !item.is_done;
  const { error } = await supabase
    .from("deal_checklist_items")
    .update({
      is_done: nextDone,
      done_at: nextDone ? new Date().toISOString() : null,
      done_by: nextDone ? gate.userId : null,
    })
    .eq("id", itemId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Durum güncellenemedi." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.checklist.toggle",
    entityType: "deal",
    entityId: item.deal_id,
    newValue: { label: item.label, is_done: nextDone },
  });

  revalidatePath(`/app/anlasmalar/${dealId}`);
  revalidatePath("/app/anlasmalar");
  return { ok: true };
}

/** Madde notunu günceller (boş gönderim notu siler). */
export async function updateItemNote(_prev: ChecklistResult, fd: FormData): Promise<ChecklistResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const itemId = String(fd.get("item_id") ?? "").trim();
  const dealId = String(fd.get("deal_id") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim();
  if (!itemId) return { error: "Madde bulunamadı." };
  if (note.length > 500) return { error: "Not en fazla 500 karakter olabilir." };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("deal_checklist_items")
    .select("id, deal_id, label")
    .eq("id", itemId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!item) return { error: "Madde bulunamadı." };

  const { error } = await supabase
    .from("deal_checklist_items")
    .update({ note: note || null })
    .eq("id", itemId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Not kaydedilemedi." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.checklist.note",
    entityType: "deal",
    entityId: item.deal_id,
    newValue: { label: item.label, note: note || null },
  });

  revalidatePath(`/app/anlasmalar/${dealId || item.deal_id}`);
  return { ok: true };
}

/** Maddeyi siler — ConfirmDialog formAction deseni (bkz. deleteDealCost). */
export async function deleteItem(fd: FormData): Promise<void> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return;

  const itemId = String(fd.get("item_id") ?? "").trim();
  const dealId = String(fd.get("deal_id") ?? "").trim();
  if (!itemId) return;

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("deal_checklist_items")
    .select("id, deal_id, label")
    .eq("id", itemId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!item) return;

  const { error } = await supabase
    .from("deal_checklist_items")
    .delete()
    .eq("id", itemId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deleteItem", error);
    return;
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.checklist.delete",
    entityType: "deal",
    entityId: item.deal_id,
    oldValue: { label: item.label },
  });

  revalidatePath(`/app/anlasmalar/${dealId || item.deal_id}`);
  revalidatePath("/app/anlasmalar");
}
