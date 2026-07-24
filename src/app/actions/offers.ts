"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

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

  revalidatePath("/app/teklifler");
  revalidatePath(`/app/teklifler/${offerId}`);
  return { ok: true };
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
