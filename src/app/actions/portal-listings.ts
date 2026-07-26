"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { estimateLostCommission } from "@/lib/leak-shield";
import { logActivity } from "@/lib/activity";
import { convertWorkflow } from "@/app/actions/workflow";

export type PortalResult = { error?: string; ok?: boolean };

export async function createPortalListing(formData: FormData): Promise<PortalResult> {
  const gate = await requirePermission("portals", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  const portalName = String(formData.get("portal_name") ?? "").trim();
  const portalListingId = String(formData.get("portal_listing_id") ?? "").trim();
  const portalUrl = String(formData.get("portal_url") ?? "").trim();

  if (!propertyId || !portalName) return { error: "Portföy ve portal seçimi zorunlu." };
  if (portalUrl && !/^https?:\/\//i.test(portalUrl)) return { error: "Geçerli bir ilan bağlantısı girin." };

  const now = new Date().toISOString();
  const { error } = await supabase.from("portal_listings").insert({
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
  return { ok: true };
}

export async function confirmPortalListing(formData: FormData): Promise<void> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("portal_listings")
    .update({ status: "live", last_confirmed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("confirmPortalListing", error);
    return;
  }

  revalidatePath("/app/portallar");
  revalidatePath("/app/kayip-kacak");
  revalidatePath("/app");
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

  const supabase = await createClient();
  const { error } = await supabase
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
}

export async function closePortalListing(formData: FormData): Promise<PortalResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const portalListingId = String(formData.get("portal_listing_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const amountRaw = String(formData.get("deal_amount") ?? "").replace(/[^\d.,]/g, "");
  const dealAmount = amountRaw ? Number(amountRaw.replace(/\./g, "").replace(",", ".")) : null;

  if (!portalListingId || !reason) return { error: "Kapanış nedeni zorunlu." };

  const { data: listing } = await supabase
    .from("portal_listings")
    .select("id, tenant_id, property_id, property:properties(id, list_price, commission_rate)")
    .eq("id", portalListingId)
    .maybeSingle();

  if (!listing || listing.tenant_id !== gate.tenantId) {
    return { error: "Portal ilanı bulunamadı." };
  }

  const propertyRel = listing.property as
    | { id?: string; list_price?: number | null; commission_rate?: number | null }
    | { id?: string; list_price?: number | null; commission_rate?: number | null }[]
    | null;
  const property = Array.isArray(propertyRel) ? propertyRel[0] : propertyRel;

  const calc = estimateLostCommission({
    reason,
    dealHappened: formData.get("deal_happened") === "on",
    closedByUs: formData.get("closed_by_us") === "on",
    competitorClosed: formData.get("competitor_closed") === "on",
    dealAmount: dealAmount && Number.isFinite(dealAmount) ? dealAmount : null,
    listPrice: property?.list_price ?? null,
    commissionRate: property?.commission_rate ?? null,
  });

  const { error: closureError } = await supabase.from("listing_closures").insert({
    tenant_id: gate.tenantId,
    portal_listing_id: portalListingId,
    reason,
    deal_happened: calc.dealHappened,
    deal_amount: calc.baseAmount > 0 && dealAmount ? dealAmount : calc.baseAmount || null,
    closed_by_us: calc.closedByUs,
    competitor_closed: calc.competitorClosed,
    estimated_lost_commission: calc.estimatedLostCommission,
    created_by: gate.userId,
  });

  if (closureError) {
    console.error("closePortalListing", closureError);
    return { error: "Kapanış kaydı oluşturulamadı." };
  }

  await supabase
    .from("portal_listings")
    .update({
      status: "removed",
      removed_at: new Date().toISOString(),
      removal_reason: reason,
      removal_meta: {
        estimated_lost_commission: calc.estimatedLostCommission,
        closed_by_us: calc.closedByUs,
        competitor_closed: calc.competitorClosed,
      },
    })
    .eq("id", portalListingId);

  // Ofis kapattıysa → deal + komisyon defteri
  if (calc.closedByUs && calc.dealHappened && (listing.property_id || property?.id)) {
    const fd = new FormData();
    fd.set("action", "create_deal_from_property");
    fd.set("property_id", String(listing.property_id || property?.id));
    if (dealAmount && Number.isFinite(dealAmount)) fd.set("deal_value", String(dealAmount));
    await convertWorkflow(fd);
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "portal.close",
    entityType: "portal_listing",
    entityId: portalListingId,
    newValue: { reason, lost: calc.estimatedLostCommission },
  });

  revalidatePath("/app/portallar");
  revalidatePath("/app/kayip-kacak");
  revalidatePath("/app/komisyon");
  revalidatePath("/app");
  return { ok: true };
}
