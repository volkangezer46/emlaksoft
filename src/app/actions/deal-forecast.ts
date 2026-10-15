"use server";

import type { ActionOutcome } from "@/lib/action-outcome";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { parseExpectedCloseDate } from "@/lib/forecast/expected-close";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SP1: anlaşmanın beklenen kapanış tarihini yazar ya da temizler (boş değer = temizle). Aşama/komisyon alanına dokunmaz
 * (atomik aşama kapısı `guard_deal_atomic_stage` bu kolonu korumaz; RLS commissions:edit + kapsam ister).
 */
export async function setDealExpectedClose(formData: FormData): Promise<ActionOutcome> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("deal_id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Anlaşma bulunamadı." };
  const parsed = parseExpectedCloseDate(String(formData.get("expected_close_date") ?? ""));
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .update({ expected_close_date: parsed.value })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Beklenen kapanış tarihi kaydedilemedi.") };
  if (!data) return { error: "Anlaşma bulunamadı ya da düzenleme yetkiniz yok." };
  revalidatePath(`/app/anlasmalar/${id}`);
  revalidatePath("/app/anlasmalar");
  return { ok: true };
}
