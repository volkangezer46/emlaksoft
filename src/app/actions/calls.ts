"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isValidTurkishMobile, normalizeTurkishPhone, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";

export type CallResult = { error?: string; ok?: boolean };

export async function createCall(formData: FormData): Promise<CallResult> {
  const gate = await requirePermission("calls", "create");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const direction = String(formData.get("direction") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const disposition = String(formData.get("disposition") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const duration = Number(formData.get("duration_sec") ?? 0);

  if (!rawPhone || !["inbound", "outbound", "missed"].includes(direction)) {
    return { error: "Telefon ve çağrı yönü zorunlu." };
  }
  if (!isValidTurkishMobile(rawPhone)) return { error: TR_MOBILE_ERROR_MESSAGE };
  const phone = normalizeTurkishPhone(rawPhone);
  if (direction !== "missed" && !disposition) {
    return { error: "Görüşme sonuç kodu zorunlu." };
  }

  const startedAt = new Date();
  const durationSec = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
  const endedAt = durationSec ? new Date(startedAt.getTime() + durationSec * 1000).toISOString() : null;

  const supabase = await createClient();
  const { error } = await supabase.from("calls").insert({
    tenant_id: gate.tenantId,
    customer_id: customerId || null,
    direction,
    phone,
    duration_sec: durationSec,
    disposition: disposition || null,
    notes: notes || null,
    handled_by: gate.userId,
    started_at: startedAt.toISOString(),
    ended_at: endedAt,
  });

  if (error) {
    console.error("createCall", error);
    return { error: "Çağrı kaydı oluşturulamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "call.create",
    entityType: "call",
    entityId: customerId || undefined,
    newValue: { direction, phone, disposition },
  });

  revalidatePath("/app/arama");
  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath("/app");
  return { ok: true };
}

export type CallSummaryResult = { error?: string; summary?: string; nextStep?: string };

/**
 * AI görüşme özeti — notu olan bir çağrı için 2 cümlelik özet + 1 sonraki adım.
 * Anlıktır, kaydedilmez (bkz. lib/ai/call-summary). Anahtar yoksa UI'da buton
 * zaten gösterilmez; yine de burada da null kontrolü yapılır.
 */
export async function summarizeCallNotes(callId: string): Promise<CallSummaryResult> {
  const gate = await requirePermission("calls", "view");
  if (!gate.ok) return { error: gate.error };

  const id = String(callId ?? "").trim();
  if (!id) return { error: "Çağrı bulunamadı." };

  const supabase = await createClient();
  const { data: call } = await supabase
    .from("calls")
    .select("id, direction, disposition, notes, duration_sec, started_at, customer:customers(full_name)")
    .eq("id", id)
    .maybeSingle();

  if (!call) return { error: "Çağrı bulunamadı." };
  if (!call.notes?.trim()) return { error: "Bu çağrının notu yok." };

  const customer = Array.isArray(call.customer) ? call.customer[0] : call.customer;
  const { generateCallSummary } = await import("@/lib/ai/call-summary");
  const result = await generateCallSummary({
    notes: call.notes,
    direction: call.direction,
    disposition: call.disposition,
    durationSec: call.duration_sec,
    customerName: customer?.full_name ?? null,
    startedAt: call.started_at,
  });

  if (!result) return { error: "AI özeti şu an üretilemedi." };
  return { summary: result.summary, nextStep: result.nextStep };
}
