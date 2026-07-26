"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { checkAuthorityShield } from "@/lib/authority-shield";
import { notifyTenant } from "@/lib/notify";
import { buildSplits, calculateCommission } from "@/lib/commission";

export type DealResult = { error?: string; ok?: boolean; dealId?: string };

export const DEAL_STAGES = ["new", "qualified", "negotiation", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export async function createPipelineDeal(formData: FormData): Promise<DealResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(formData.get("property_id") ?? "").trim() || null;
  const customerId = String(formData.get("customer_id") ?? "").trim() || null;
  const dealType = String(formData.get("deal_type") ?? "sale").trim() === "rent" ? "rent" : "sale";
  const stageRaw = String(formData.get("stage") ?? "new").trim();
  const stage = (DEAL_STAGES as readonly string[]).includes(stageRaw) ? stageRaw : "new";
  const amountRaw = String(formData.get("deal_value") ?? "").replace(/[^\d.,]/g, "");
  const dealValue = amountRaw ? Number(amountRaw.replace(/\./g, "").replace(",", ".")) : null;
  const hasAuthority = String(formData.get("has_authority") ?? "") === "1";

  // Pipeline girişinde yetki; erken aşamada uyarı zorunlu değil — müzakere/won için şart
  if (stage === "negotiation" || stage === "won") {
    const shield = checkAuthorityShield({ hasWrittenAuthority: hasAuthority });
    if (!shield.ok) return { error: shield.warning ?? "Yetki belgesi gerekli." };
  }

  const supabase = await createClient();
  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      tenant_id: gate.tenantId,
      property_id: propertyId,
      customer_id: customerId,
      deal_type: dealType,
      stage,
      deal_value: dealValue && Number.isFinite(dealValue) ? dealValue : null,
      probability: stage === "won" ? 100 : stage === "negotiation" ? 60 : stage === "qualified" ? 40 : 20,
      assigned_to: gate.userId,
    })
    .select("id")
    .single();

  if (error || !deal) {
    console.error("createPipelineDeal", error);
    return { error: "Anlaşma oluşturulamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.create",
    entityType: "deal",
    entityId: deal.id,
    newValue: { stage, deal_type: dealType },
  });

  revalidatePath("/app/anlasmalar");
  revalidatePath("/app/komisyon");
  revalidatePath("/app");
  return { ok: true, dealId: deal.id };
}

export async function updateDealStage(formData: FormData): Promise<DealResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("deal_id") ?? "").trim();
  const stageRaw = String(formData.get("stage") ?? "").trim();
  if (!id || !(DEAL_STAGES as readonly string[]).includes(stageRaw)) {
    return { error: "Geçersiz aşama." };
  }
  const stage = stageRaw as DealStage;
  const lossReason = String(formData.get("loss_reason") ?? "").trim() || null;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("deals")
    .select("id, stage, property_id, customer_id, deal_type, deal_value")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!existing) return { error: "Anlaşma bulunamadı." };

  const { error } = await supabase
    .from("deals")
    .update({
      stage,
      loss_reason: stage === "lost" ? lossReason : null,
      probability: stage === "won" ? 100 : stage === "lost" ? 0 : stage === "negotiation" ? 60 : stage === "qualified" ? 40 : 20,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: "Aşama güncellenemedi." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.stage",
    entityType: "deal",
    entityId: id,
    oldValue: { stage: existing.stage },
    newValue: { stage, loss_reason: lossReason },
  });

  // Otomasyon tetikle — hata ana işlemi asla bozmasın
  if (stage === "lost" && existing.stage !== "lost") {
    try {
      await dispatchAutomationEvent(gate.tenantId, "deal_lost", {
        entityType: "deal",
        entityId: id,
        dealId: id,
        customerId: existing.customer_id,
        propertyId: existing.property_id,
        assignedTo: gate.userId,
        fields: { loss_reason: lossReason, deal_type: existing.deal_type, deal_value: existing.deal_value },
      });
    } catch (e) {
      console.error("automation deal_lost", e);
    }
  }

  // Won’a geçişte komisyon yoksa üret (pipeline içi — yetki property workflow’da zorunlu)
  if (stage === "won" && existing.property_id && existing.stage !== "won") {
    const { data: existingComm } = await supabase
      .from("commissions")
      .select("id")
      .eq("deal_id", id)
      .maybeSingle();

    if (!existingComm) {
      await ensureCommissionForDeal(gate.tenantId, gate.userId, id, existing.property_id, existing.deal_value);
    }

    await notifyTenant({
      tenantId: gate.tenantId,
      title: "Anlaşma kazanıldı",
      body: "Pipeline’da won · komisyon kontrol edin",
      href: "/app/komisyon",
      kind: "success",
    });

    // Otomasyon tetikle — hata ana işlemi asla bozmasın
    try {
      await dispatchAutomationEvent(gate.tenantId, "deal_won", {
        entityType: "deal",
        entityId: id,
        dealId: id,
        customerId: existing.customer_id,
        propertyId: existing.property_id,
        assignedTo: gate.userId,
        fields: { deal_type: existing.deal_type, deal_value: existing.deal_value },
      });
    } catch (e) {
      console.error("automation deal_won", e);
    }
  }

  revalidatePath("/app/anlasmalar");
  revalidatePath("/app/komisyon");
  revalidatePath("/app");
  return { ok: true, dealId: id };
}

export async function updateDeal(formData: FormData): Promise<DealResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("deal_id") ?? "").trim();
  if (!id) return { error: "Anlaşma bulunamadı." };

  const amountRaw = String(formData.get("deal_value") ?? "").replace(/[^\d.,]/g, "");
  const dealValue = amountRaw ? Number(amountRaw.replace(/\./g, "").replace(",", ".")) : null;
  const probRaw = String(formData.get("probability") ?? "").trim();
  const probability = probRaw ? Math.max(0, Math.min(100, Number(probRaw))) : null;
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  const dealType = String(formData.get("deal_type") ?? "").trim();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (amountRaw) patch.deal_value = dealValue && Number.isFinite(dealValue) ? dealValue : null;
  if (probRaw && probability != null && Number.isFinite(probability)) patch.probability = probability;
  if (assignedTo) patch.assigned_to = assignedTo;
  if (dealType === "sale" || dealType === "rent") patch.deal_type = dealType;

  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateDeal", error);
    return { error: "Anlaşma güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.update",
    entityType: "deal",
    entityId: id,
    newValue: patch,
  });

  revalidatePath("/app/anlasmalar");
  revalidatePath("/app/komisyon");
  return { ok: true, dealId: id };
}

// ============================================================
// İşlem dosyası — kapora + masraf kalemleri (deal_costs)
// ============================================================

export const DEAL_COST_KINDS = ["kapora", "tapu_harci", "ekspertiz", "komisyon_dis", "diger"] as const;
export type DealCostKind = (typeof DEAL_COST_KINDS)[number];

export type DealCost = {
  id: string;
  kind: DealCostKind;
  label: string | null;
  amount: number;
  paid: boolean;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
};

/** Anlaşmanın işlem dosyası kalemlerini kronolojik sırayla getirir. */
export async function listDealCosts(dealId: string): Promise<DealCost[]> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("deal_costs")
    .select("id, kind, label, amount, paid, paid_at, notes, created_at")
    .eq("deal_id", dealId)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: true });

  return (data as DealCost[] | null) ?? [];
}

/** İşlem dosyasına kalem ekler; kapora kaleminde anlaşma aktivitesine düşer. */
export async function addDealCost(_prev: DealResult, fd: FormData): Promise<DealResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const dealId = String(fd.get("deal_id") ?? "").trim();
  const kindRaw = String(fd.get("kind") ?? "").trim();
  const label = String(fd.get("label") ?? "").trim() || null;
  const amount = parseFloat(String(fd.get("amount") ?? "0"));
  const notes = String(fd.get("notes") ?? "").trim() || null;

  if (!dealId) return { error: "Anlaşma bulunamadı." };
  if (!(DEAL_COST_KINDS as readonly string[]).includes(kindRaw)) {
    return { error: "Geçerli bir kalem türü seçin." };
  }
  if (isNaN(amount) || amount <= 0) return { error: "Geçerli bir tutar girin." };
  const kind = kindRaw as DealCostKind;

  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!deal) return { error: "Anlaşma bulunamadı." };

  const { error } = await supabase.from("deal_costs").insert({
    tenant_id: gate.tenantId,
    deal_id: dealId,
    kind,
    label,
    amount,
    notes,
    created_by: gate.userId,
  });

  if (error) {
    console.error("addDealCost", error);
    return { error: "Kalem kaydedilemedi." };
  }

  // Kapora anlaşmanın kilit anıdır — zaman çizgisine/aktiviteye düşsün
  if (kind === "kapora") {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "deal.kapora",
      entityType: "deal",
      entityId: dealId,
      newValue: { amount, label },
    });
  }

  revalidatePath(`/app/anlasmalar/${dealId}`);
  return { ok: true, dealId };
}

/** Kalemin ödendi durumunu tersine çevirir; paid_at buna göre yazılır/silinir. */
export async function toggleDealCostPaid(costId: string, dealId: string): Promise<DealResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: cost } = await supabase
    .from("deal_costs")
    .select("id, paid, deal_id")
    .eq("id", costId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!cost) return { error: "Kalem bulunamadı." };

  const nextPaid = !cost.paid;
  const { error } = await supabase
    .from("deal_costs")
    .update({ paid: nextPaid, paid_at: nextPaid ? new Date().toISOString() : null })
    .eq("id", costId)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: "Durum güncellenemedi." };

  revalidatePath(`/app/anlasmalar/${dealId}`);
  return { ok: true, dealId };
}

/** İşlem dosyası kalemini siler — ConfirmDialog formAction deseni. */
export async function deleteDealCost(fd: FormData): Promise<void> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return;

  const costId = String(fd.get("cost_id") ?? "").trim();
  const dealId = String(fd.get("deal_id") ?? "").trim();
  if (!costId) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("deal_costs")
    .delete()
    .eq("id", costId)
    .eq("tenant_id", gate.tenantId);
  if (error) console.error("deleteDealCost", error);

  if (dealId) revalidatePath(`/app/anlasmalar/${dealId}`);
}

// ============================================================
// Not/yorum akışı (deal_notes) — denetim bulgusu: anlaşmaya yorum yazılamıyordu
// ============================================================

export type DealNote = {
  id: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
};

/** Anlaşmanın notlarını kronolojik (eski → yeni) sırayla getirir. */
export async function listDealNotes(dealId: string): Promise<DealNote[]> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("deal_notes")
    .select("id, body, author_id, created_at, author:profiles(full_name)")
    .eq("deal_id", dealId)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: true })
    .limit(200);

  return (data ?? []).map((n) => {
    const author = n.author as { full_name?: string } | { full_name?: string }[] | null;
    const a = Array.isArray(author) ? author[0] : author;
    return {
      id: n.id as string,
      body: n.body as string,
      author_id: (n.author_id as string | null) ?? null,
      author_name: a?.full_name ?? null,
      created_at: n.created_at as string,
    };
  });
}

/** Anlaşmaya not ekler — 1-2000 karakter (DB check ile aynı sınır). */
export async function addDealNote(_prev: DealResult, fd: FormData): Promise<DealResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const dealId = String(fd.get("deal_id") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();
  if (!dealId) return { error: "Anlaşma bulunamadı." };
  if (!body) return { error: "Not boş olamaz." };
  if (body.length > 2000) return { error: "Not en fazla 2000 karakter olabilir." };

  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!deal) return { error: "Anlaşma bulunamadı." };

  const { error } = await supabase.from("deal_notes").insert({
    tenant_id: gate.tenantId,
    deal_id: dealId,
    author_id: gate.userId,
    body,
  });

  if (error) {
    console.error("addDealNote", error);
    return { error: "Not kaydedilemedi." };
  }

  revalidatePath(`/app/anlasmalar/${dealId}`);
  revalidatePath("/app/anlasmalar");
  return { ok: true, dealId };
}

/**
 * Notu siler — YALNIZ yazarı silebilir. RLS zaten kilitliyor; action'da da
 * kontrol edilir ki kullanıcı sessiz no-op yerine anlamlı hata görsün.
 * ConfirmDialog formAction deseni (bkz. deleteDealCost).
 */
export async function deleteDealNote(fd: FormData): Promise<void> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return;

  const noteId = String(fd.get("note_id") ?? "").trim();
  const dealId = String(fd.get("deal_id") ?? "").trim();
  if (!noteId) return;

  const supabase = await createClient();
  const { data: note } = await supabase
    .from("deal_notes")
    .select("id, author_id")
    .eq("id", noteId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!note || note.author_id !== gate.userId) return; // yalnız kendi notu

  const { error } = await supabase
    .from("deal_notes")
    .delete()
    .eq("id", noteId)
    .eq("tenant_id", gate.tenantId)
    .eq("author_id", gate.userId);
  if (error) console.error("deleteDealNote", error);

  if (dealId) revalidatePath(`/app/anlasmalar/${dealId}`);
  revalidatePath("/app/anlasmalar");
}

async function ensureCommissionForDeal(
  tenantId: string,
  userId: string,
  dealId: string,
  propertyId: string,
  dealValue: number | null,
) {
  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select("list_price, commission_rate, property_code")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) return;

  const value = dealValue != null && Number.isFinite(Number(dealValue)) ? Number(dealValue) : Number(property.list_price) || 0;
  // KDV orani ve paylasim burada SABIT yazilmisti (0.2 ve 50/50); ayni sabitler
  // workflow.ts'te de vardi. Tek kaynaga tasindi (lib/commission.ts).
  const calc = calculateCommission({
    amount: value,
    rate: Number(property.commission_rate) || undefined,
  });
  const splits = buildSplits(calc.net);

  await supabase.from("commissions").insert({
    tenant_id: tenantId,
    deal_id: dealId,
    gross_amount: calc.net,
    vat_amount: calc.vat,
    status: "calculated",
    splits,
  });

  await supabase
    .from("properties")
    .update({ status: "sold", updated_at: new Date().toISOString() })
    .eq("id", propertyId);

  await logActivity({
    tenantId,
    actorId: userId,
    action: "commission.from_pipeline",
    entityType: "deal",
    entityId: dealId,
    newValue: { gross: calc.net, vat: calc.vat, property_code: property.property_code },
  });
}
