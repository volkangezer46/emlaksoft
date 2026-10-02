"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { triggerPlaybooks } from "@/lib/playbook-trigger";
import { checkAuthorityShield } from "@/lib/authority-shield";
import { notifyTenant } from "@/lib/notify";
import { validateTenantReferences } from "@/lib/tenant-references";
import { parseMoneyInput } from "@/lib/money-input";
import {
  DEAL_STAGES as WORKFLOW_DEAL_STAGES,
  isDealStage,
  isDealTransitionAllowed,
  type DealStage,
} from "@/lib/workflow-state";

export type DealResult = { error?: string; ok?: boolean; dealId?: string };

export const DEAL_STAGES = WORKFLOW_DEAL_STAGES;
export type { DealStage };

export async function createPipelineDeal(formData: FormData): Promise<DealResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(formData.get("property_id") ?? "").trim() || null;
  const customerId = String(formData.get("customer_id") ?? "").trim() || null;
  const dealType = String(formData.get("deal_type") ?? "sale").trim() === "rent" ? "rent" : "sale";
  const stageRaw = String(formData.get("stage") ?? "new").trim();
  const creatableStages = new Set<DealStage>(["new", "qualified", "negotiation"]);
  const stage = (DEAL_STAGES as readonly string[]).includes(stageRaw)
    ? stageRaw as DealStage
    : "new";
  if (!creatableStages.has(stage)) return { error: "Yeni anlaşma kapanmış aşamada oluşturulamaz." };
  const amountResult = parseMoneyInput(formData.get("deal_value"), { max: 100_000_000_000 });
  if (!amountResult.ok) return { error: "Geçerli bir anlaşma tutarı girin." };
  const dealValue = amountResult.value;
  const hasAuthority = String(formData.get("has_authority") ?? "") === "1";

  // Pipeline girişinde yetki; erken aşamada uyarı zorunlu değil — müzakere/won için şart
  if (stage === "negotiation" || stage === "won") {
    const shield = checkAuthorityShield({ hasWrittenAuthority: hasAuthority });
    if (!shield.ok) return { error: shield.warning ?? "Yetki belgesi gerekli." };
  }
  if (stage === "negotiation" && (!propertyId || !customerId)) {
    return { error: "Müzakere aşaması için portföy ve müşteri zorunludur." };
  }

  const references = await validateTenantReferences(gate.tenantId, {
    propertyId,
    customerId,
  });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      tenant_id: gate.tenantId,
      property_id: propertyId,
      customer_id: customerId,
      deal_type: dealType,
      stage,
      deal_value: dealValue,
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
  if (stage === "lost" && !lossReason) return { error: "Kayıp nedeni zorunludur." };

  const admin = createAdminClient();
  const { data: existing, error: loadError } = await admin
    .from("deals")
    .select("id, stage, property_id, customer_id, deal_type, deal_value")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (loadError) return { error: "Anlaşma durumu okunamadı." };
  if (!existing) return { error: "Anlaşma bulunamadı." };
  if (!isDealStage(existing.stage) || !isDealTransitionAllowed(existing.stage, stage)) {
    return { error: "Bu aşama geçişi desteklenmiyor." };
  }
  if (stage === "won" && existing.stage !== "won") {
    if (existing.deal_type === "rent") {
      return { error: "Kiralama kapanışı; kira sözleşmesi, komisyon ve portföy birlikte kaydedilsin diye Kiralama ekranından tamamlanmalıdır." };
    }
    const createGate = await requirePermission("commissions", "create");
    if (!createGate.ok) return { error: createGate.error };
  }
  if (existing.stage === "won" && stage !== "won") {
    const deleteGate = await requirePermission("commissions", "delete");
    if (!deleteGate.ok) return { error: deleteGate.error };
  }

  const { data: transitionData, error } = await admin.rpc("transition_deal_stage_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_deal_id: id,
    p_stage: stage,
    p_loss_reason: lossReason,
    p_expected_stage: existing.stage,
  });
  if (error) {
    console.error("updateDealStage atomic", { code: error.code });
    return { error: "Aşama, komisyon ve portföy durumu birlikte güncellenemedi." };
  }
  const transition = transitionData && typeof transitionData === "object" && !Array.isArray(transitionData)
    ? transitionData as Record<string, unknown>
    : null;
  const outcome = typeof transition?.outcome === "string" ? transition.outcome : "invalid_result";
  if (outcome === "commission_settled") {
    return { error: "Komisyon tahsil edilmiş. Önce Komisyon ekranından tahsilatı geri alın." };
  }
  if (outcome === "payment_in_progress") {
    return { error: "Bağlı ödeme bağlantısı varken anlaşma geri açılamaz; önce finans ekibiyle bağlantıyı kapatın." };
  }
  if (outcome === "rental_lifecycle_required") {
    return { error: "Kiralama kaydına bağlı anlaşma buradan geri açılamaz; Kiralama ekranındaki yaşam döngüsünü kullanın." };
  }
  if (outcome === "conflict") return { error: "Anlaşma aşaması başka bir işlemde değişti. Sayfayı yenileyin." };
  if (outcome === "property_required") return { error: "Kazanmak için anlaşmaya portföy bağlayın." };
  if (outcome === "customer_required") return { error: "Kazanmak için anlaşmaya müşteri bağlayın." };
  if (outcome === "deal_value_required") return { error: "Kazanmak için geçerli anlaşma tutarı girin." };
  if (outcome === "commission_rate_required") return { error: "Kapanıştan önce portföyde 0'dan büyük geçerli bir komisyon oranı tanımlayın." };
  if (outcome === "property_already_closed") return { error: "Bu portföy için kazanılmış başka bir anlaşma var." };
  if (outcome === "property_unavailable") return { error: "Portföyün mevcut durumu bu kapanış türüyle uyuşmuyor." };
  if (outcome === "property_active_rental") return { error: "Bu portföy için zaten aktif bir kiralama kaydı var." };
  if (outcome === "invalid_transition") return { error: "Bu aşama geçişi desteklenmiyor." };
  if (outcome !== "applied" && outcome !== "replay") return { error: "Aşama güncellenemedi." };

  const previousStage = typeof transition?.previous_stage === "string"
    ? transition.previous_stage
    : existing.stage;
  const propertyId = typeof transition?.property_id === "string" ? transition.property_id : existing.property_id;
  const customerId = typeof transition?.customer_id === "string" ? transition.customer_id : existing.customer_id;
  const dealType = typeof transition?.deal_type === "string" ? transition.deal_type : existing.deal_type;
  const dealValue = typeof transition?.deal_value === "number" ? transition.deal_value : existing.deal_value;

  // Otomasyon tetikle — hata ana işlemi asla bozmasın
  if (outcome === "applied" && stage === "lost" && previousStage !== "lost") {
    try {
      await dispatchAutomationEvent(gate.tenantId, "deal_lost", {
        entityType: "deal",
        entityId: id,
        dealId: id,
        customerId,
        propertyId,
        assignedTo: gate.userId,
        fields: { loss_reason: lossReason, deal_type: dealType, deal_value: dealValue },
      });
    } catch (e) {
      console.error("automation deal_lost", e);
    }
  }

  if (outcome === "applied" && stage === "won" && previousStage !== "won") {
    try {
      await notifyTenant({
        tenantId: gate.tenantId,
        title: "Anlaşma kazanıldı",
        body: "Pipeline’da won · komisyon kontrol edin",
        href: "/app/komisyon",
        kind: "success",
      });
    } catch (notificationError) {
      console.error("updateDealStage notification", notificationError);
    }

    // Otomasyon tetikle — hata ana işlemi asla bozmasın
    try {
      await dispatchAutomationEvent(gate.tenantId, "deal_won", {
        entityType: "deal",
        entityId: id,
        dealId: id,
        customerId,
        propertyId,
        assignedTo: gate.userId,
        fields: { deal_type: dealType, deal_value: dealValue },
      });
    } catch (e) {
      console.error("automation deal_won", e);
    }

    // İş akışı (playbook) tetikle — kapanış sonrası görev paketi
    await triggerPlaybooks({
      tenantId: gate.tenantId,
      event: "anlasma_kazanildi",
      actorId: gate.userId,
      entity: {
        type: "deal",
        id,
        ownerId: gate.userId,
        dealId: id,
        customerId,
        propertyId,
        fields: { deal_type: dealType },
      },
    });
  }

  revalidatePath("/app/anlasmalar");
  revalidatePath("/app/komisyon");
  revalidatePath("/app/portfoyler");
  if (propertyId) revalidatePath(`/app/portfoyler/${propertyId}`);
  revalidatePath("/app");
  return { ok: true, dealId: id };
}

export async function updateDeal(formData: FormData): Promise<DealResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("deal_id") ?? "").trim();
  if (!id) return { error: "Anlaşma bulunamadı." };

  const amountRaw = String(formData.get("deal_value") ?? "").trim();
  const amountResult = parseMoneyInput(amountRaw, { max: 100_000_000_000 });
  if (!amountResult.ok) return { error: "Geçerli bir anlaşma tutarı girin." };
  const probRaw = String(formData.get("probability") ?? "").trim();
  const probability = probRaw ? Number(probRaw) : null;
  if (probRaw && (!Number.isFinite(probability) || probability == null || probability < 0 || probability > 100)) {
    return { error: "Olasılık 0-100 arasında olmalı." };
  }
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  const dealType = String(formData.get("deal_type") ?? "").trim();

  const references = await validateTenantReferences(gate.tenantId, {
    profileId: assignedTo || null,
  });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase
    .from("deals")
    .select("id, stage, deal_value, deal_type")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (currentError || !current) return { error: "Anlaşma bulunamadı." };
  if (current.stage === "won" && (
    (amountResult.value != null && Number(current.deal_value) !== amountResult.value)
    || ((dealType === "sale" || dealType === "rent") && dealType !== current.deal_type)
  )) {
    return { error: "Kazanılmış anlaşmanın tutarı/türü değiştirilemez; önce kazanmayı geri alın." };
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (amountResult.value != null) patch.deal_value = amountResult.value;
  if (probRaw && probability != null) patch.probability = probability;
  if (assignedTo) patch.assigned_to = assignedTo;
  if (dealType === "sale" || dealType === "rent") patch.deal_type = dealType;

  const { data: updated, error } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("stage", current.stage)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("updateDeal", error);
    return { error: "Anlaşma güncellenemedi." };
  }
  if (!updated) return { error: "Anlaşma aşaması başka bir işlemde değişti. Sayfayı yenileyin." };

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
  const amountResult = parseMoneyInput(fd.get("amount"), { max: 100_000_000_000 });
  const notes = String(fd.get("notes") ?? "").trim() || null;

  if (!dealId) return { error: "Anlaşma bulunamadı." };
  if (!(DEAL_COST_KINDS as readonly string[]).includes(kindRaw)) {
    return { error: "Geçerli bir kalem türü seçin." };
  }
  if (!amountResult.ok || amountResult.value == null) return { error: "Geçerli bir tutar girin." };
  const amount = amountResult.value;
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
    .select("id, body, author_id, created_at, author:profiles!deal_notes_author_id_fkey(full_name)")
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
