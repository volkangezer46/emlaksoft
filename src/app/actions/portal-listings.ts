"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { normalizeCloseFlags } from "@/lib/leak-shield";
import { parseMoneyInput } from "@/lib/money-input";
import { validateTenantReferences } from "@/lib/tenant-references";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { actionErrorMessage } from "@/lib/action-errors";

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

  // İlan no DEĞİŞİMİ: eski satır kapanır ('superseded'), yenisi supersedes_id ile zincirlenir (yeni geçmiş tablosu yok).
  const supersedesId = String(formData.get("supersedes_id") ?? "").trim();
  const candidateId = String(formData.get("candidate_id") ?? "").trim();
  if (supersedesId) {
    if (!portalListingId) return { error: "Yeni ilan numarası zorunlu." };
    const { data: old } = await admin
      .from("portal_listings")
      .select("property_id")
      .eq("id", supersedesId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!old || (old as { property_id: string }).property_id !== propertyId) return { error: "Değiştirilecek portal ilanı bulunamadı." };
    const { data: rot, error: rotError } = await admin.rpc("lc_rotate_portal_listing", {
      p_tenant_id: gate.tenantId,
      p_actor_id: gate.userId,
      p_listing_id: supersedesId,
      p_new_external_id: portalListingId,
      p_new_url: portalUrl || null,
      p_reason: null,
    });
    if (rotError) {
      console.error("createPortalListing rotate", { code: rotError.code });
      return { error: isMissingSchema(rotError) ? "İlan numarası değişimi için sistem güncellemesi bekleniyor." : actionErrorMessage(rotError, "İlan numarası değiştirilemedi.") };
    }
    const rotOutcome = String((rot as { outcome?: string } | null)?.outcome ?? "");
    if (rotOutcome === "external_id_in_use") return { error: "Bu ilan numarası bu portalda zaten başka bir ilana bağlı." };
    if (rotOutcome === "unchanged") return { error: "İlan numarası aynı; değişiklik yok." };
    if (rotOutcome === "not_live") return { error: "Yalnız yayındaki ilanın numarası değiştirilebilir." };
    if (rotOutcome !== "applied") return { error: actionErrorMessage(null, "İlan numarası değiştirilemedi.") };
  } else {
    // Bağlama: aynı (ofis, portal, ilan no) açıkken tekrar = replay; başka portföye bağlıysa reddedilir.
    const { data: bound, error: bindError } = await admin.rpc("lc_bind_portal_listing", {
      p_tenant_id: gate.tenantId,
      p_actor_id: gate.userId,
      p_property_id: propertyId,
      p_portal_name: portalName,
      p_external_id: portalListingId || null,
      p_url: portalUrl || null,
      p_source_kind: "manual",
      p_created_via: candidateId ? "matching" : "bind",
    });
    if (bindError && !isMissingSchema(bindError)) {
      console.error("createPortalListing bind", { code: bindError.code });
      return { error: actionErrorMessage(bindError, "Portal ilanı eklenemedi.") };
    }
    if (bindError) {
      // Migration uygulanmamış: eski doğrudan ekleme yolu (davranış değişmez).
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
        return { error: actionErrorMessage(error, "Portal ilanı eklenemedi.") };
      }
    } else {
      const outcome = String((bound as { outcome?: string } | null)?.outcome ?? "");
      if (outcome === "bound_to_other_property") return { error: "Bu ilan numarası bu portalda başka bir portföye bağlı." };
      if (outcome !== "applied" && outcome !== "replay") return { error: actionErrorMessage(null, "Portal ilanı eklenemedi.") };
      if (candidateId) {
        // Kayıtsız ilan eşleştirme adayını bağlandı olarak işaretle (en iyi çaba).
        await admin.rpc("lc_decide_matching_candidate", {
          p_tenant_id: gate.tenantId,
          p_candidate_id: candidateId,
          p_status: "linked",
          p_actor_id: gate.userId,
          p_linked_listing_id: (bound as { listing_id?: string } | null)?.listing_id ?? null,
        });
      }
    }
  }

  revalidatePath("/app/portallar");
  revalidatePath("/app/portfoyler");
  revalidatePath("/app/kayip-kacak");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}

/**
 * "Teyit et" = İlan Kontrol'de elle doğrulama. Kalkan'ın `last_confirmed_at` damgası ile doğrulama sonuç günlüğü
 * (`listing_verifications` / kontrol durumu) AYNI olayı iki yerde tutmasın diye teyit, kullanıcı oturumuyla
 * `lc_submit_manual_check('present')` RPC'sine de yazılır (JWT'den ofis/kullanıcı, izin + kapsam RPC'de; admin client
 * KULLANILMAZ). En iyi çaba: şema yoksa/RPC reddederse teyit damgası yine de geçerlidir.
 */
async function recordManualPresent(listingIds: readonly string[]): Promise<void> {
  const ids = [...new Set(listingIds)].slice(0, 100);
  if (ids.length === 0) return;
  try {
    const supabase = await createClient();
    for (const id of ids) {
      const { error } = await supabase.rpc("lc_submit_manual_check", { p_listing_id: id, p_result: "present", p_observed: {} });
      if (error && !isMissingSchema(error)) console.error("recordManualPresent", { code: error.code });
    }
  } catch (e) {
    console.error("recordManualPresent", e);
  }
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
  await recordManualPresent([id]);

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
  await recordManualPresent(ids);

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
    return { error: actionErrorMessage(error, "İlan kapanışı ve finans kayıtları birlikte tamamlanamadı.") };
  }
  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  const outcome = typeof result?.outcome === "string" ? result.outcome : "invalid_result";
  if (outcome === "not_found") return { error: "Portal ilanı bulunamadı." };
  if (outcome === "closing_evidence_required") return { error: "Müşteri ve yazılı yetki belgesi onayı zorunludur." };
  if (outcome === "commission_rate_required") return { error: "Kapanıştan önce portföyde 0'dan büyük geçerli bir komisyon oranı tanımlayın." };
  if (outcome !== "applied" && outcome !== "replay") return { error: actionErrorMessage(null, "Kapanış kaydı oluşturulamadı.") };

  revalidatePath("/app/portallar");
  revalidatePath("/app/kayip-kacak");
  revalidatePath("/app/komisyon");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}
