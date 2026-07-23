"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { checkAuthorityShield } from "@/lib/authority-shield";
import { notifyTenant } from "@/app/actions/notifications";

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
  const rate = Number(property.commission_rate) || 3;
  const gross = Math.round(value * (rate / 100) * 100) / 100;
  const vat = Math.round(gross * 0.2 * 100) / 100;
  const splits = [
    { label: "Danışman", rate: 50, amount: Math.round(gross * 0.5 * 100) / 100 },
    { label: "Ofis", rate: 50, amount: Math.round(gross * 0.5 * 100) / 100 },
  ];

  await supabase.from("commissions").insert({
    tenant_id: tenantId,
    deal_id: dealId,
    gross_amount: gross,
    vat_amount: vat,
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
    newValue: { gross, property_code: property.property_code },
  });
}
