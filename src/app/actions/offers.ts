"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { logActivity } from "@/lib/activity";

export type OfferResult = { ok?: boolean; error?: string; id?: string };

export async function createOffer(
  _prev: OfferResult,
  fd: FormData,
): Promise<OfferResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(fd.get("property_id") ?? "").trim();
  const customerId = String(fd.get("customer_id") ?? "").trim() || null;
  const amount     = parseFloat(String(fd.get("amount") ?? "0"));
  const validUntil = String(fd.get("valid_until") ?? "").trim() || null;
  const notes      = String(fd.get("notes") ?? "").trim() || null;

  if (!propertyId) return { error: "Portföy seçimi zorunludur." };
  if (isNaN(amount) || amount <= 0) return { error: "Geçerli bir teklif tutarı girin." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("offers")
    .insert({
      tenant_id:   gate.tenantId,
      property_id: propertyId,
      customer_id: customerId,
      created_by:  gate.userId,
      amount,
      valid_until: validUntil,
      notes,
      status:      "submitted",
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Teklif kaydedilemedi." };

  // İlk teklif = 1. pazarlık turu (alıcı) — hata ana işlemi asla bozmasın
  try {
    await supabase.from("offer_rounds").insert({
      tenant_id:  gate.tenantId,
      offer_id:   data.id,
      round_no:   1,
      side:       "buyer",
      amount,
      note:       notes,
      created_by: gate.userId,
    });
  } catch (e) {
    console.error("offer_rounds initial round", e);
  }

  // Otomasyon tetikle — hata ana işlemi asla bozmasın
  try {
    await dispatchAutomationEvent(gate.tenantId, "offer_received", {
      entityType: "offer",
      entityId: data.id,
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
  return { ok: true, id: data.id };
}

export async function updateOfferStatus(
  offerId: string,
  status: "accepted" | "rejected" | "countered" | "withdrawn",
  counterAmount?: number,
): Promise<OfferResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  await supabase
    .from("offers")
    .update({
      status,
      counter_amount: counterAmount ?? null,
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", offerId)
    .eq("tenant_id", gate.tenantId);

  // GERİYE UYUMLU: karşı teklif counter_amount'ı güncellemeye devam eder,
  // ek olarak satıcı turu olarak pazarlık geçmişine de düşer.
  if (status === "countered" && counterAmount && counterAmount > 0) {
    try {
      const nextNo = await nextRoundNo(supabase, offerId);
      await supabase.from("offer_rounds").insert({
        tenant_id:  gate.tenantId,
        offer_id:   offerId,
        round_no:   nextNo,
        side:       "seller",
        amount:     counterAmount,
        created_by: gate.userId,
      });
    } catch (e) {
      console.error("offer_rounds counter round", e);
    }
  }

  revalidatePath("/app/teklifler");
  revalidatePath(`/app/teklifler/${offerId}`);
  return { ok: true };
}

/** Bir sonraki tur numarası = son tur + 1 (tur yoksa 1). */
async function nextRoundNo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  offerId: string,
): Promise<number> {
  const { data } = await supabase
    .from("offer_rounds")
    .select("round_no")
    .eq("offer_id", offerId)
    .order("round_no", { ascending: false })
    .limit(1);
  return ((data?.[0]?.round_no as number | undefined) ?? 0) + 1;
}

/** Pazarlık turu ekler — kapanmış (accepted/rejected/withdrawn) teklife tur eklenemez. */
export async function addOfferRound(
  _prev: OfferResult,
  fd: FormData,
): Promise<OfferResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const offerId = String(fd.get("offer_id") ?? "").trim();
  const side    = String(fd.get("side") ?? "").trim();
  const amount  = parseFloat(String(fd.get("amount") ?? "0"));
  const note    = String(fd.get("note") ?? "").trim() || null;

  if (!offerId) return { error: "Teklif bulunamadı." };
  if (side !== "buyer" && side !== "seller") return { error: "Geçerli bir taraf seçin." };
  if (isNaN(amount) || amount <= 0) return { error: "Geçerli bir tutar girin." };

  const supabase = await createClient();
  const { data: offer } = await supabase
    .from("offers")
    .select("id, status")
    .eq("id", offerId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!offer) return { error: "Teklif bulunamadı." };
  if (["accepted", "rejected", "withdrawn"].includes(offer.status)) {
    return { error: "Kapanmış teklife tur eklenemez." };
  }

  const nextNo = await nextRoundNo(supabase, offerId);
  const { error } = await supabase.from("offer_rounds").insert({
    tenant_id:  gate.tenantId,
    offer_id:   offerId,
    round_no:   nextNo,
    side,
    amount,
    note,
    created_by: gate.userId,
  });

  if (error) return { error: "Tur kaydedilemedi." };

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
  const gate = await requirePermission("commissions", "view");
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
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Teklif bulunamadı." };

  const amount     = parseFloat(String(fd.get("amount") ?? "0"));
  const validUntil = String(fd.get("valid_until") ?? "").trim() || null;
  const notes      = String(fd.get("notes") ?? "").trim() || null;

  if (isNaN(amount) || amount <= 0) return { error: "Geçerli bir teklif tutarı girin." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("offers")
    .update({ amount, valid_until: validUntil, notes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: "Teklif güncellenemedi." };

  revalidatePath("/app/teklifler");
  revalidatePath(`/app/teklifler/${id}`);
  return { ok: true, id };
}

/** Tek teklifi ilişkili portföy + müşteri ID'leriyle getirir (detay sayfası için). */
export async function getOffer(id: string) {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("offers")
    .select(
      "id, amount, currency, status, counter_amount, valid_until, notes, submitted_at, responded_at, created_at, updated_at, property_id, customer_id, property:properties(id, property_code, title, list_price, transaction_type, property_type), customer:customers(id, full_name, phone, email)",
    )
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

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
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: offer } = await supabase
    .from("offers")
    .select("id, amount, status, property_id, customer_id")
    .eq("id", offerId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!offer) return { error: "Teklif bulunamadı." };
  if (offer.status !== "accepted") {
    return { error: "Yalnızca kabul edilmiş teklif anlaşmaya dönüştürülebilir." };
  }

  // 1) Kesin bağ zaten var mı? (deal_id kolonu yoksa sorgu hata döner → yok say)
  const { data: linkRow } = await supabase
    .from("offers")
    .select("deal_id")
    .eq("id", offerId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  const alreadyLinked = (linkRow as { deal_id?: string | null } | null)?.deal_id ?? null;
  if (alreadyLinked) return { ok: true, dealId: alreadyLinked, linked: true };

  // 2) Aynı müşteri + portföy için açık anlaşma
  if (offer.property_id && offer.customer_id) {
    const { data: openDeals } = await supabase
      .from("deals")
      .select("id, stage")
      .eq("tenant_id", gate.tenantId)
      .eq("property_id", offer.property_id)
      .eq("customer_id", offer.customer_id)
      .not("stage", "in", "(won,lost)")
      .order("created_at", { ascending: false })
      .limit(1);

    const openDeal = openDeals?.[0];
    if (openDeal) {
      await linkOfferToDeal(supabase, gate.tenantId, offerId, openDeal.id);
      revalidatePath(`/app/teklifler/${offerId}`);
      revalidatePath(`/app/anlasmalar/${openDeal.id}`);
      return { ok: true, dealId: openDeal.id, linked: true };
    }
  }

  // 3) Yeni anlaşma — negotiation aşamasında, teklif tutarıyla
  let dealType: "sale" | "rent" = "sale";
  if (offer.property_id) {
    const { data: property } = await supabase
      .from("properties")
      .select("transaction_type")
      .eq("id", offer.property_id)
      .maybeSingle();
    const tt = String(property?.transaction_type ?? "").toLowerCase();
    if (tt.includes("kira") || tt.includes("rent")) dealType = "rent";
  }

  const dealValue = Number(offer.amount) || null;
  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      tenant_id: gate.tenantId,
      property_id: offer.property_id,
      customer_id: offer.customer_id,
      deal_type: dealType,
      stage: "negotiation",
      deal_value: dealValue,
      probability: 60,
      assigned_to: gate.userId,
    })
    .select("id")
    .single();

  if (error || !deal) {
    console.error("convertOfferToDeal", error);
    return { error: "Anlaşma oluşturulamadı." };
  }

  await linkOfferToDeal(supabase, gate.tenantId, offerId, deal.id);

  // Kaynak izi: audit log'un yanında kullanıcı görünür bir sistem notu —
  // anlaşma detayındaki not akışına düşer (deal_notes, migration 000094).
  // Hata ana akışı asla bozmasın (tablo yoksa da dönüşüm tamamlanır).
  try {
    const tutar = dealValue != null
      ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(dealValue)
      : "—";
    const tarih = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
    const { error: noteError } = await supabase.from("deal_notes").insert({
      tenant_id: gate.tenantId,
      deal_id: deal.id,
      author_id: gate.userId,
      body: `Tekliften dönüştürüldü: ₺${tutar} — ${tarih}`,
    });
    if (noteError) console.error("convertOfferToDeal note", noteError);
  } catch (e) {
    console.error("convertOfferToDeal note", e);
  }

  // Kaynak izi: bu anlaşma teklif kabulünden doğdu
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "deal.from_offer",
    entityType: "deal",
    entityId: deal.id,
    newValue: { offer_id: offerId, amount: dealValue, stage: "negotiation" },
  });

  revalidatePath(`/app/teklifler/${offerId}`);
  revalidatePath("/app/anlasmalar");
  return { ok: true, dealId: deal.id, linked: false };
}

/** offers.deal_id bağını kurar — kolon yoksa/hata olursa ana akışı bozmaz. */
async function linkOfferToDeal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  offerId: string,
  dealId: string,
) {
  try {
    const { error } = await supabase
      .from("offers")
      .update({ deal_id: dealId, updated_at: new Date().toISOString() })
      .eq("id", offerId)
      .eq("tenant_id", tenantId);
    if (error) console.error("linkOfferToDeal", error);
  } catch (e) {
    console.error("linkOfferToDeal", e);
  }
}

export async function listOffers(propertyId?: string) {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  let query = supabase
    .from("offers")
    .select("id, amount, currency, status, counter_amount, valid_until, notes, submitted_at, responded_at, created_at, property:properties(property_code, title, list_price), customer:customers(full_name)")
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (propertyId) query = query.eq("property_id", propertyId);

  const { data } = await query;
  return data ?? [];
}
