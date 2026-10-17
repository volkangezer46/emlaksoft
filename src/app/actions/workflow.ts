"use server";

import { financePath } from "@/lib/finance/routes";
import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { commissionLedgerDenied } from "@/lib/permission-data-scope";
import { logActivity } from "@/lib/activity";
import { checkAuthorityShield } from "@/lib/authority-shield";
import { notifyTenant } from "@/lib/notify";
import { parseMoneyInput } from "@/lib/money-input";
import { validateTenantReferences } from "@/lib/tenant-references";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, trDayKey } from "@/lib/clock";
import { commissionCashAmount, decideCollectionAccount, recordCollectionCash } from "@/lib/finance/cash/collection-link";

export type WorkflowResult = {
  error?: string;
  ok?: boolean;
  dealId?: string;
  commissionId?: string;
  info?: string;
  /** Ofiste hesap yok: tahsilatı kasaya yazmadan işaretlemek için bilinçli onay (form `no_cash=1`) gerekir (SK6/B109). */
  needsCashConfirm?: boolean;
};

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
  // Portföyden doğrudan KAZANILMIŞ anlaşma + komisyon açar ve tahsilat işaretler: komisyon defteri yazımıdır (WP2).
  const ledger = await commissionLedgerDenied(gate);
  if (ledger) return { error: ledger };

  const action = String(formData.get("action") ?? "").trim();
  const supabase = await createClient();

  if (action === "create_deal_from_property") {
    const propertyId = String(formData.get("property_id") ?? "").trim();
    const customerId = String(formData.get("customer_id") ?? "").trim() || null;
    const dealType = String(formData.get("deal_type") ?? "sale").trim() === "rent" ? "rent" : "sale";
    const amountResult = parseMoneyInput(formData.get("deal_value"), { max: 100_000_000_000 });
    if (!amountResult.ok) return { error: "Geçerli bir anlaşma tutarı girin." };
    const advisorShare = Number(String(formData.get("advisor_share") ?? "50"));
    if (!Number.isFinite(advisorShare) || advisorShare < 0 || advisorShare > 100) {
      return { error: "Danışman payı 0-100 arasında olmalı." };
    }
    const hasAuthority = String(formData.get("has_authority") ?? "") === "1";

    if (!propertyId) return { error: "Portföy zorunlu." };
    if (!customerId) return { error: "Kapanış için işlem yapılan müşteriyi seçin." };
    if (dealType === "rent") {
      return { error: "Kiralık anlaşma kapanışı; kira sözleşmesi, komisyon ve portföy tek işlemde oluşsun diye Mülk yönetimi ekranından tamamlanmalıdır." };
    }

    const shield = checkAuthorityShield({ hasWrittenAuthority: hasAuthority });
    if (!shield.ok) return { error: shield.warning ?? "Yetki belgesi gerekli." };

    const references = await validateTenantReferences(gate.tenantId, {
      propertyId,
      customerId,
    });
    if (!references.ok) return { error: references.error };

    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("id, list_price, transaction_type, title, property_code")
      .eq("id", propertyId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();

    if (propertyError || !property) return { error: "Portföy bulunamadı." };
    const value = amountResult.value ?? Number(property.list_price);
    if (!Number.isFinite(value) || value <= 0) return { error: "Kapanış için geçerli anlaşma tutarı girin." };

    const admin = createAdminClient();
    const { data: closeData, error: closeError } = await admin.rpc("create_won_deal_atomic", {
      p_tenant_id: gate.tenantId,
      p_actor_id: gate.userId,
      p_property_id: propertyId,
      p_customer_id: customerId,
      p_deal_type: dealType,
      p_deal_value: value,
      p_advisor_share: advisorShare,
    });
    if (closeError) {
      console.error("convertWorkflow atomic close", { code: closeError.code });
      return { error: actionErrorMessage(closeError, "Anlaşma, komisyon ve portföy durumu birlikte oluşturulamadı.") };
    }
    const close = closeData && typeof closeData === "object" && !Array.isArray(closeData)
      ? closeData as Record<string, unknown>
      : null;
    if (close?.outcome === "property_already_closed") {
      return { error: "Bu portföy zaten kazanılmış bir anlaşmaya bağlı." };
    }
    if (close?.outcome === "commission_rate_required") {
      return { error: "Kapanıştan önce portföyde 0'dan büyük, en çok iki ondalık haneli geçerli bir komisyon oranı tanımlayın." };
    }
    if (close?.outcome !== "created" || typeof close.deal_id !== "string" || typeof close.commission_id !== "string") {
      return { error: actionErrorMessage(null, "Kapanış kaydı oluşturulamadı.") };
    }
    const dealId = close.deal_id;
    const commissionId = close.commission_id;
    const kapanisBasligi = "Satış kapandı · komisyon hesaplandı";

    try {
      await notifyTenant({
        tenantId: gate.tenantId,
        title: kapanisBasligi,
        body: `${property.property_code}: kapanış ve komisyon kaydı hazır`,
        href: financePath("komisyon"),
        kind: "success",
      });
    } catch (notificationError) {
      console.error("convertWorkflow notification", notificationError);
    }

    revalidatePath(financePath("komisyon"));
    revalidatePath("/app/anlasmalar");
    revalidatePath("/app/portfoyler");
    revalidatePath(`/app/portfoyler/${propertyId}`);
    revalidatePath("/app/raporlar");
    revalidatePath("/app");
    revalidateTenantData(gate.tenantId);
    return { ok: true, dealId, commissionId };
  }

  if (action === "mark_commission_paid") {
    const id = String(formData.get("commission_id") ?? "").trim();
    if (!id) return { error: "Komisyon bulunamadı." };
    // SK6/B109: ofiste hesap varsa "Hangi hesaba girdi?" zorunlu; hesap yoksa yalnız bilinçli onayla (no_cash=1) kasaya yazmadan.
    const decision = await decideCollectionAccount(supabase, {
      accountId: String(formData.get("account_id") ?? ""),
      skipCash: String(formData.get("no_cash") ?? "") === "1",
    });
    if (!decision.ok) return { error: decision.error, needsCashConfirm: decision.code === "confirm_no_cash" || undefined };
    const { data: updated, error } = await supabase
      .from("commissions")
      .update({ status: "paid" })
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .not("status", "in", "(paid,collected)")
      .select("id, gross_amount, vat_amount")
      .maybeSingle();
    if (error) return { error: actionErrorMessage(error, "Durum güncellenemedi.") };
    if (!updated) return { error: "Komisyon bulunamadı veya zaten tahsil edilmiş." };
    // Kasaya KDV DAHİL tahsilat (gross_amount KDV hariç matrah).
    const info = await recordCollectionCash(supabase, {
      accountId: decision.accountId, sourceType: "commission", sourceId: id,
      amount: commissionCashAmount(updated), date: trDayKey(now()), title: "Komisyon tahsilatı",
    });
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "commission.paid",
      entityType: "commission",
      entityId: id,
      newValue: { account_id: decision.accountId, cash_skipped: decision.accountId === null },
    });
    revalidatePath(financePath("komisyon"));
    revalidateTenantData(gate.tenantId);
    return { ok: true, commissionId: id, info: info ?? undefined };
  }

  return { error: "Bilinmeyen iş akışı." };
}
