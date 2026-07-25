"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { checkAuthorityShield } from "@/lib/authority-shield";
import { notifyTenant } from "@/app/actions/notifications";

export type WorkflowResult = { error?: string; ok?: boolean; dealId?: string; commissionId?: string };

/**
 * Kapanış / satış → deal + commission omurgası (HGDekor convert benzeri).
 * action: create_deal_from_property | mark_commission_paid
 */
export async function convertWorkflow(formData: FormData): Promise<WorkflowResult> {
  const actionPeek = String(formData.get("action") ?? "").trim();
  const gate = await requirePermission(
    "commissions",
    actionPeek === "mark_commission_paid" ? "edit" : "create",
  );
  if (!gate.ok) return { error: gate.error };

  const action = String(formData.get("action") ?? "").trim();
  const supabase = await createClient();

  if (action === "create_deal_from_property") {
    const propertyId = String(formData.get("property_id") ?? "").trim();
    const customerId = String(formData.get("customer_id") ?? "").trim() || null;
    const dealType = String(formData.get("deal_type") ?? "sale").trim() === "rent" ? "rent" : "sale";
    const amountRaw = String(formData.get("deal_value") ?? "").replace(/[^\d.,]/g, "");
    const dealValue = amountRaw ? Number(amountRaw.replace(/\./g, "").replace(",", ".")) : null;
    const advisorShare = Number(String(formData.get("advisor_share") ?? "50")) || 50;
    const officeShare = Math.max(0, 100 - advisorShare);
    const hasAuthority = String(formData.get("has_authority") ?? "") === "1";

    if (!propertyId) return { error: "Portföy zorunlu." };

    const shield = checkAuthorityShield({ hasWrittenAuthority: hasAuthority });
    if (!shield.ok) return { error: shield.warning ?? "Yetki belgesi gerekli." };

    const { data: property } = await supabase
      .from("properties")
      .select("id, list_price, commission_rate, transaction_type, assigned_to, title, property_code")
      .eq("id", propertyId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();

    if (!property) return { error: "Portföy bulunamadı." };

    // Idempotency: bu portföy için zaten kazanılan anlaşma varsa çift komisyonu engelle
    const { data: existingDeal } = await supabase
      .from("deals")
      .select("id")
      .eq("property_id", propertyId)
      .eq("tenant_id", gate.tenantId)
      .eq("stage", "won")
      .limit(1)
      .maybeSingle();
    if (existingDeal) return { error: "Bu portföy zaten anlaşmaya dönüştürülmüş." };

    const value = dealValue && Number.isFinite(dealValue) ? dealValue : Number(property.list_price) || 0;
    const rate = Number(property.commission_rate) || 3;
    const gross = Math.round(value * (rate / 100) * 100) / 100;
    const vat = Math.round(gross * 0.2 * 100) / 100;

    const { data: deal, error: dealErr } = await supabase
      .from("deals")
      .insert({
        tenant_id: gate.tenantId,
        property_id: propertyId,
        customer_id: customerId,
        deal_type: dealType,
        stage: "won",
        deal_value: value,
        probability: 100,
        assigned_to: property.assigned_to ?? gate.userId,
      })
      .select("id")
      .single();

    if (dealErr || !deal) {
      console.error("convert deal", dealErr);
      return { error: "Deal oluşturulamadı." };
    }

    const splits = [
      { label: "Danışman", rate: advisorShare, amount: Math.round(gross * (advisorShare / 100) * 100) / 100 },
      { label: "Ofis", rate: officeShare, amount: Math.round(gross * (officeShare / 100) * 100) / 100 },
    ];

    const { data: commission, error: cErr } = await supabase
      .from("commissions")
      .insert({
        tenant_id: gate.tenantId,
        deal_id: deal.id,
        gross_amount: gross,
        vat_amount: vat,
        status: "calculated",
        splits,
      })
      .select("id")
      .single();

    if (cErr) {
      console.error("convert commission", cErr);
      return { error: "Komisyon kaydı oluşturulamadı." };
    }

    // property update + logActivity + notifyTenant birbirinden bağımsız → paralel
    await Promise.all([
      supabase
        .from("properties")
        .update({ status: "sold", updated_at: new Date().toISOString() })
        .eq("id", propertyId),
      logActivity({
        tenantId: gate.tenantId,
        actorId: gate.userId,
        action: "workflow.deal_won",
        entityType: "deal",
        entityId: deal.id,
        newValue: { property_id: propertyId, gross, splits },
      }),
      notifyTenant({
        tenantId: gate.tenantId,
        title: "Satış kapandı · komisyon hesaplandı",
        body: `${property.property_code}: ${gross.toLocaleString("tr-TR")} ₺ brüt`,
        href: "/app/komisyon",
        kind: "success",
      }),
    ]);

    revalidatePath("/app/komisyon");
    revalidatePath("/app/anlasmalar");
    revalidatePath("/app/portfoyler");
    revalidatePath(`/app/portfoyler/${propertyId}`);
    revalidatePath("/app/raporlar");
    revalidatePath("/app");
    return { ok: true, dealId: deal.id, commissionId: commission?.id };
  }

  if (action === "mark_commission_paid") {
    const id = String(formData.get("commission_id") ?? "").trim();
    if (!id) return { error: "Komisyon bulunamadı." };
    const { error } = await supabase
      .from("commissions")
      .update({ status: "paid" })
      .eq("id", id)
      .eq("tenant_id", gate.tenantId);
    if (error) return { error: "Durum güncellenemedi." };
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "commission.paid",
      entityType: "commission",
      entityId: id,
    });
    revalidatePath("/app/komisyon");
    return { ok: true, commissionId: id };
  }

  return { error: "Bilinmeyen iş akışı." };
}
