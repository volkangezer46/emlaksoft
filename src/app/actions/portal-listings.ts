"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { normalizeCloseFlags } from "@/lib/leak-shield";
import { parseMoneyInput } from "@/lib/money-input";
import { validateTenantReferences } from "@/lib/tenant-references";

export type PortalResult = { error?: string; ok?: boolean };

export async function createPortalListing(formData: FormData): Promise<PortalResult> {
  const gate = await requirePermission("portals", "create");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  const portalName = String(formData.get("portal_name") ?? "").trim();
  const portalListingId = String(formData.get("portal_listing_id") ?? "").trim();
  const portalUrl = String(formData.get("portal_url") ?? "").trim();

  if (!propertyId || !portalName) return { error: "Portföy ve portal seçimi zorunlu." };
  if (portalName.length > 80 || portalListingId.length > 200 || portalUrl.length > 2048) {
    return { error: "Portal bilgileri izin verilen uzunluğu aşıyor." };
  }
  if (portalUrl && !/^https?:\/\//i.test(portalUrl)) return { error: "Geçerli bir ilan bağlantısı girin." };
  const references = await validateTenantReferences(gate.tenantId, { propertyId });
  if (!references.ok) return { error: references.error };

  const now = new Date().toISOString();
  const { error } = await admin.from("portal_listings").insert({
    tenant_id: gate.tenantId,
    property_id: propertyId,
    portal_name: portalName,
    portal_listing_id: portalListingId || null,
    portal_url: portalUrl || null,
    status: "live",
    last_confirmed_at: now,
    published_at: now,
    published_by: gate.userId,
  });

  if (error) {
    console.error("createPortalListing", error);
    return { error: "Portal ilanı eklenemedi." };
  }

  revalidatePath("/app/portallar");
  revalidatePath("/app/portfoyler");
  revalidatePath("/app/kayip-kacak");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}

export async function confirmPortalListing(formData: FormData): Promise<void> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("portal_listings")
    .update({ last_confirmed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "live")
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    console.error("confirmPortalListing", error);
    return;
  }

  revalidatePath("/app/portallar");
  revalidatePath("/app/kayip-kacak");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
}

/**
 * Toplu teyit — tekil `confirmPortalListing`in çok kayıtlı hali.
 * Tek update + `.in()` ile çalışır; yalnızca canlı ilanlar teyitlenir
 * (kapanmış bir kaydı yanlışlıkla diriltmemek için status koşulu var).
 */
export async function confirmPortalListingsBulk(formData: FormData): Promise<void> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return;
  const ids = [...new Set(formData.getAll("ids").map((v) => String(v).trim()).filter(Boolean))];
  if (ids.length === 0) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from("portal_listings")
    .update({ last_confirmed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "live");
  if (error) {
    console.error("confirmPortalListingsBulk", error);
    return;
  }

  revalidatePath("/app/portallar");
  revalidatePath("/app/kayip-kacak");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
}

export async function closePortalListing(formData: FormData): Promise<PortalResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };

  const portalListingId = String(formData.get("portal_listing_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const amountResult = parseMoneyInput(formData.get("deal_amount"), { max: 100_000_000_000 });
  const customerId = String(formData.get("customer_id") ?? "").trim() || null;
  const authorityConfirmed = formData.get("has_authority") === "on";

  if (!portalListingId || !reason) return { error: "Kapanış nedeni zorunlu." };
  if (reason.length > 500) return { error: "Kapanış nedeni en fazla 500 karakter olabilir." };
  if (!amountResult.ok) return { error: "Geçerli bir işlem bedeli girin." };
  const flags = normalizeCloseFlags({
    reason,
    dealHappened: formData.get("deal_happened") === "on",
    closedByUs: formData.get("closed_by_us") === "on",
    competitorClosed: formData.get("competitor_closed") === "on",
  });
  if (flags.closedByUs && flags.dealHappened && (!customerId || !authorityConfirmed)) {
    return { error: "Bizim kapanışımız için müşteri ve yazılı yetki belgesi onayı zorunludur." };
  }
  if (flags.closedByUs && flags.dealHappened) {
    const financialGate = await requirePermission("commissions", "create");
    if (!financialGate.ok) return { error: financialGate.error };
  }
  if (customerId) {
    const references = await validateTenantReferences(gate.tenantId, { customerId });
    if (!references.ok) return { error: references.error };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("close_portal_listing_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_listing_id: portalListingId,
    p_reason: reason,
    p_deal_happened: flags.dealHappened,
    p_closed_by_us: flags.closedByUs,
    p_competitor_closed: flags.competitorClosed,
    p_deal_amount: amountResult.value,
    p_customer_id: customerId,
    p_authority_confirmed: authorityConfirmed,
  });
  if (error) {
    console.error("closePortalListing atomic", { code: error.code });
    return { error: "İlan kapanışı ve finans kayıtları birlikte tamamlanamadı." };
  }
  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  const outcome = typeof result?.outcome === "string" ? result.outcome : "invalid_result";
  if (outcome === "not_found") return { error: "Portal ilanı bulunamadı." };
  if (outcome === "closing_evidence_required") return { error: "Müşteri ve yazılı yetki belgesi onayı zorunludur." };
  if (outcome === "commission_rate_required") return { error: "Kapanıştan önce portföyde 0'dan büyük geçerli bir komisyon oranı tanımlayın." };
  if (outcome !== "applied" && outcome !== "replay") return { error: "Kapanış kaydı oluşturulamadı." };

  revalidatePath("/app/portallar");
  revalidatePath("/app/kayip-kacak");
  revalidatePath("/app/komisyon");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}
