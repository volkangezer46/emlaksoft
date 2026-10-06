"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { validateTenantReferences } from "@/lib/tenant-references";
import { parseMoneyInput } from "@/lib/money-input";
import { isIsoDate } from "@/lib/workflow-state";

export type OfferResult = { ok?: boolean; error?: string; id?: string };

export async function createOffer(
  _prev: OfferResult,
  fd: FormData,
): Promise<OfferResult> {
  const gate = await requirePermission("offers", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(fd.get("property_id") ?? "").trim();
  const customerId = String(fd.get("customer_id") ?? "").trim() || null;
  const amountResult = parseMoneyInput(fd.get("amount"), { max: 100_000_000_000 });
  const validUntil = String(fd.get("valid_until") ?? "").trim() || null;
  const notes      = String(fd.get("notes") ?? "").trim() || null;

  if (!propertyId) return { error: "Portföy seçimi zorunludur." };
  if (!amountResult.ok || amountResult.value == null) return { error: "Geçerli bir teklif tutarı girin." };
  if (validUntil && !isIsoDate(validUntil)) return { error: "Geçerli bir teklif son tarihi girin." };
  if (validUntil && validUntil < new Date().toISOString().slice(0, 10)) {
    return { error: "Teklif son tarihi geçmişte olamaz." };
  }
  if (notes && notes.length > 5000) return { error: "Teklif notu en fazla 5000 karakter olabilir." };
  const amount = amountResult.value;

  const references = await validateTenantReferences(gate.tenantId, {
    propertyId,
    customerId,
  });
  if (!references.ok) return { error: references.error };

  const admin = createAdminClient();
  const { data: transitionData, error } = await admin.rpc("create_offer_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_property_id: propertyId,
    p_customer_id: customerId,
    p_amount: amount,
    p_valid_until: validUntil,
    p_notes: notes,
  });
  if (error) {
    console.error("createOffer atomic", { code: error.code });
    return { error: "Teklif ve pazarlık kaydı oluşturulamadı." };
  }
  const transition = transitionData && typeof transitionData === "object" && !Array.isArray(transitionData)
    ? transitionData as Record<string, unknown>
    : null;
  if (transition?.outcome !== "created" || typeof transition.offer_id !== "string") {
    return { error: "Teklif kaydedilemedi." };
  }
  const offerId = transition.offer_id;

  // Otomasyon tetikle — hata ana işlemi asla bozmasın
  try {
    await dispatchAutomationEvent(gate.tenantId, "offer_received", {
      entityType: "offer",
      entityId: offerId,
      propertyId,
      customerId,
      assignedTo: gate.userId,
      fields: { amount },
    });
  } catch (e) {
    console.error("automation offer_received", e);
  }

  revalidatePath("/app/teklifler");
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, id: offerId };
}

export async function updateOfferStatus(
  offerId: string,
  status: "accepted" | "rejected" | "countered" | "withdrawn",
  counterAmount?: number,
): Promise<OfferResult> {
  const gate = await requirePermission("offers", "edit");
  if (!gate.ok) return { error: gate.error };
  const counterResult = status === "countered"
    ? parseMoneyInput(counterAmount, { max: 100_000_000_000 })
    : { ok: true as const, value: null };
  if (!counterResult.ok || (status === "countered" && counterResult.value == null)) {
    return { error: "Karşı teklif için geçerli bir tutar girin." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("transition_offer_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_offer_id: offerId,
    p_status: status,
    p_counter_amount: status === "countered" ? counterResult.value : null,
  });
  if (error) {
    console.error("updateOfferStatus atomic", { code: error.code });
    return { error: "Teklif durumu güncellenemedi." };
  }
  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  const outcome = typeof result?.outcome === "string" ? result.outcome : "invalid_result";
  if (outcome === "not_found") return { error: "Teklif bulunamadı." };
  if (outcome === "invalid_transition") return { error: "Kapanmış bir teklif yeniden açılamaz." };
  if (outcome === "expired") return { error: "Süresi dolmuş teklif kabul edilemez veya karşılanamaz." };
  if (outcome !== "applied" && outcome !== "replay") return { error: "Teklif durumu güncellenemedi." };

  revalidatePath("/app/teklifler");
  revalidatePath(`/app/teklifler/${offerId}`);
  return { ok: true };
}

/** Pazarlık turu ekler — kapanmış (accepted/rejected/withdrawn) teklife tur eklenemez. */
export async function addOfferRound(
  _prev: OfferResult,
  fd: FormData,
): Promise<OfferResult> {
  const gate = await requirePermission("offers", "edit");
  if (!gate.ok) return { error: gate.error };

  const offerId = String(fd.get("offer_id") ?? "").trim();
  const side    = String(fd.get("side") ?? "").trim();
  const amountResult = parseMoneyInput(fd.get("amount"), { max: 100_000_000_000 });
  const note    = String(fd.get("note") ?? "").trim() || null;

  if (!offerId) return { error: "Teklif bulunamadı." };
  if (side !== "buyer" && side !== "seller") return { error: "Geçerli bir taraf seçin." };
  if (!amountResult.ok || amountResult.value == null) return { error: "Geçerli bir tutar girin." };
  if (note && note.length > 2000) return { error: "Tur notu en fazla 2000 karakter olabilir." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("add_offer_round_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_offer_id: offerId,
    p_side: side,
    p_amount: amountResult.value,
    p_note: note,
  });
  if (error) {
    console.error("addOfferRound atomic", { code: error.code });
    return { error: "Tur kaydedilemedi." };
  }
  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  if (result?.outcome === "not_found") return { error: "Teklif bulunamadı." };
  if (result?.outcome === "invalid_state") return { error: "Kapanmış teklife tur eklenemez." };
  if (result?.outcome === "expired") return { error: "Süresi dolmuş teklife yeni pazarlık turu eklenemez." };
  if (result?.outcome !== "created") return { error: "Tur kaydedilemedi." };

  revalidatePath(`/app/teklifler/${offerId}`);
  return { ok: true, id: offerId };
}

export type OfferRound = {
  id: string;
  round_no: number;
  side: "buyer" | "seller";
  amount: number;
  note: string | null;
  created_at: string;
};

/** Teklifin pazarlık turlarını kronolojik sırayla getirir. */
export async function listOfferRounds(offerId: string): Promise<OfferRound[]> {
  const gate = await requirePermission("offers", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("offer_rounds")
    .select("id, round_no, side, amount, note, created_at")
    .eq("offer_id", offerId)
    .eq("tenant_id", gate.tenantId)
    .order("round_no", { ascending: true });

  return (data as OfferRound[] | null) ?? [];
}

/** Teklif tutarı / geçerlilik / not düzenleme. */
export async function updateOffer(
  _prev: OfferResult,
  fd: FormData,
): Promise<OfferResult> {
  const gate = await requirePermission("offers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Teklif bulunamadı." };

  const amountResult = parseMoneyInput(fd.get("amount"), { max: 100_000_000_000 });
  const validUntil = String(fd.get("valid_until") ?? "").trim() || null;
  const notes      = String(fd.get("notes") ?? "").trim() || null;

  if (!amountResult.ok || amountResult.value == null) return { error: "Geçerli bir teklif tutarı girin." };
  if (validUntil && !isIsoDate(validUntil)) return { error: "Geçerli bir teklif son tarihi girin." };
  if (validUntil && validUntil < new Date().toISOString().slice(0, 10)) {
    return { error: "Teklif son tarihi geçmişte olamaz." };
  }
  if (notes && notes.length > 5000) return { error: "Teklif notu en fazla 5000 karakter olabilir." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("update_offer_terms_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_offer_id: id,
    p_expected_amount: amountResult.value,
    p_valid_until: validUntil,
    p_notes: notes,
  });
  if (error) return { error: "Teklif güncellenemedi." };
  const outcome = String((data as { outcome?: string } | null)?.outcome ?? "");
  if (outcome === "not_found") return { error: "Teklif bulunamadı." };
  if (outcome === "amount_immutable") {
    return { error: "Gönderilmiş teklifin tutarı değiştirilemez; yeni bir pazarlık turu ekleyin." };
  }
  if (outcome === "expired") return { error: "Teklif son tarihi geçmişte olamaz." };
  if (outcome === "invalid_state") return { error: "Kapanmış teklifin koşulları değiştirilemez." };
  if (outcome !== "applied" && outcome !== "replay") return { error: "Teklif güncellenemedi." };

  revalidatePath("/app/teklifler");
  revalidatePath(`/app/teklifler/${id}`);
  return { ok: true, id };
}

/** Tek teklifi ilişkili portföy + müşteri ID'leriyle getirir (detay sayfası için). */
export async function getOffer(id: string) {
  const gate = await requirePermission("offers", "view");
  if (!gate.ok) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("offers")
    .select(
      "id, amount, currency, status, counter_amount, valid_until, notes, submitted_at, responded_at, created_at, updated_at, created_by, property_id, customer_id, property:properties!offers_property_id_fkey(id, property_code, title, list_price, transaction_type, property_type), customer:customers!offers_customer_id_fkey(id, full_name, phone, email)",
    )
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  // B2: ofis geneli kapsam dışındaki roller id ile yalnız kendi oluşturdukları teklifi açabilir.
  if (data && !hasOfficeWideDataScope(gate.role) && data.created_by !== gate.userId) return null;

  return data;
}

export type ConvertOfferResult = {
  ok?: boolean;
  error?: string;
  /** Bağlanan / oluşturulan anlaşma — başarıda /app/anlasmalar/{dealId} */
  dealId?: string;
  /** true → mevcut açık anlaşmaya bağlandı, false → yeni anlaşma açıldı */
  linked?: boolean;
};

/**
 * Kabul edilmiş teklifi anlaşmaya dönüştürür.
 *
 * Sıra:
 *  1) Teklif zaten bir anlaşmaya bağlıysa (offers.deal_id) onu döndür.
 *  2) Aynı müşteri + portföy için AÇIK (won/lost olmayan) anlaşma varsa
 *     teklifi ona bağla ve onu döndür — mükerrer pipeline kaydı açılmasın.
 *  3) Yoksa negotiation aşamasında yeni anlaşma aç: deal_value = teklif
 *     tutarı, deal_type portföyün işlem türünden türetilir; kaynak izi
 *     audit log'a "deal.from_offer" olarak düşer (deals'te not kolonu yok).
 *
 * offers.deal_id yazımı ana akışı asla bozmaz — migration henüz
 * uygulanmadıysa bağ kurulamaz ama anlaşma yine oluşur/bulunur.
 */
export async function convertOfferToDeal(offerId: string): Promise<ConvertOfferResult> {
  const offerGate = await requirePermission("offers", "edit");
  if (!offerGate.ok) return { error: offerGate.error };
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("convert_offer_to_deal_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_offer_id: offerId,
  });
  if (error) {
    console.error("convertOfferToDeal atomic", { code: error.code });
    return { error: "Teklif anlaşmaya dönüştürülemedi; hiçbir kısmi kayıt oluşturulmadı." };
  }
  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  const outcome = typeof result?.outcome === "string" ? result.outcome : "invalid_result";
  if (outcome === "not_found") return { error: "Teklif bulunamadı." };
  if (outcome === "invalid_state") return { error: "Yalnızca kabul edilmiş teklif anlaşmaya dönüştürülebilir." };
  if ((outcome !== "applied" && outcome !== "replay") || typeof result?.deal_id !== "string") {
    return { error: "Teklif anlaşmaya dönüştürülemedi." };
  }
  const dealId = result.deal_id;
  const linked = outcome === "replay" || result.linked === true;

  revalidatePath(`/app/teklifler/${offerId}`);
  revalidatePath("/app/anlasmalar");
  revalidatePath(`/app/anlasmalar/${dealId}`);
  revalidateTenantData(gate.tenantId);
  return { ok: true, dealId, linked };
}

export type BulkOfferResult = { error?: string; updated?: number; failed?: number; firstError?: string };

/**
 * Toplu teklif kapatma (liste toplu işlemi): yalnız "reddedildi" ya da "geri çekildi". Her teklif tek tek
 * atomik geçiş RPC'sinden (`updateOfferStatus`) geçer; kabul/karşı teklif toplu yapılmaz (tutar/anlaşma etkisi).
 */
export async function bulkUpdateOfferStatus(ids: string[], status: string): Promise<BulkOfferResult> {
  const gate = await requirePermission("offers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (status !== "rejected" && status !== "withdrawn") return { error: "Toplu işlemde yalnız reddet / geri çek yapılabilir." };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const list = Array.isArray(ids) ? [...new Set(ids.map((v) => String(v)).filter((v) => uuid.test(v)))].slice(0, 100) : [];
  if (list.length === 0) return { error: "Teklif seçin." };
  let updated = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const id of list) {
    const res = await updateOfferStatus(id, status);
    if (res.ok) updated += 1;
    else {
      failed += 1;
      firstError ??= res.error;
    }
  }
  return { updated, failed, firstError };
}
