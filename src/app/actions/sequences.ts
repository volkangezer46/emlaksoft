"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { MAX_ENROLL_BATCH, nextDueAt, parseSequenceSteps } from "@/lib/automation/sequence-rules";

/**
 * Takip dizileri (COM-05) sunucu eylemleri. Dizi tanımı otomasyon ekranıyla aynı yetkidir (settings:edit); müşteri
 * kaydetme/durdurma müşteri düzenleme yetkisidir (customers:edit). RLS aynı kuralları ikinci kez uygular
 * (20261018070001_message_sequences.sql). Adım sonucu yalnız cron (service_role) yazar.
 */

export type SequenceActionResult = { ok?: boolean; error?: string; id?: string; enrolled?: number; skipped?: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOT = "/app/otomasyonlar/diziler";

function missingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}
const MISSING = "Takip dizileri henüz kurulmadı (veritabanı güncellemesi bekleniyor).";

export async function saveSequence(formData: FormData): Promise<SequenceActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  if (id && !UUID_RE.test(id)) return { error: "Dizi bulunamadı." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) return { error: "Dizi adı zorunlu." };
  const description = String(formData.get("description") ?? "").trim().slice(0, 300) || null;
  const stopOnReply = String(formData.get("stop_on_reply") ?? "true") !== "false";
  const isActive = String(formData.get("is_active") ?? "true") !== "false";
  const cap = Number(formData.get("daily_cap") ?? 200);
  if (!Number.isInteger(cap) || cap < 1 || cap > 2000) return { error: "Günlük üst sınır 1-2000 arasında olmalı." };

  let rawSteps: unknown;
  try {
    rawSteps = JSON.parse(String(formData.get("steps") ?? "[]"));
  } catch {
    return { error: "Adımlar okunamadı; sayfayı yenileyip adımları yeniden kaydedin." };
  }
  const parsed = parseSequenceSteps(rawSteps);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const row = { name, description, stop_on_reply: stopOnReply, is_active: isActive, daily_cap: cap, updated_at: new Date().toISOString() };
  let sequenceId = id;
  if (id) {
    const { data, error } = await supabase
      .from("message_sequences")
      .update(row)
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .select("id")
      .maybeSingle();
    if (missingTable(error)) return { error: MISSING };
    if (error) return { error: actionErrorMessage(error, "Dizi güncellenemedi.") };
    if (!data) return { error: "Dizi bulunamadı." };
  } else {
    const { data, error } = await supabase
      .from("message_sequences")
      .insert({ ...row, tenant_id: gate.tenantId, created_by: gate.userId })
      .select("id")
      .single();
    if (missingTable(error)) return { error: MISSING };
    if (error || !data) return { error: actionErrorMessage(error, "Dizi kaydedilemedi.") };
    sequenceId = String(data.id);
  }

  // Adımlar bütün olarak yenilenir (sıra = sort_order). Devam eden kayıtlar kaldıkları adım numarasından sürer.
  const { error: delErr } = await supabase
    .from("message_sequence_steps")
    .delete()
    .eq("sequence_id", sequenceId)
    .eq("tenant_id", gate.tenantId);
  if (delErr) return { error: actionErrorMessage(delErr, "Adımlar güncellenemedi.") };
  const { error: insErr } = await supabase.from("message_sequence_steps").insert(
    parsed.steps.map((s, i) => ({
      tenant_id: gate.tenantId,
      sequence_id: sequenceId,
      sort_order: i,
      delay_days: s.delay_days,
      step_type: s.step_type,
      config: s.config,
    })),
  );
  if (insErr) return { error: actionErrorMessage(insErr, "Adımlar kaydedilemedi.") };

  revalidatePath(ROOT);
  revalidatePath(`${ROOT}/${sequenceId}`);
  return { ok: true, id: sequenceId };
}

export async function toggleSequence(id: string, active: boolean): Promise<SequenceActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Dizi bulunamadı." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("message_sequences")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Durum güncellenemedi.") };
  revalidatePath(ROOT);
  revalidatePath(`${ROOT}/${id}`);
  return { ok: true };
}

export async function deleteSequence(id: string): Promise<SequenceActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Dizi bulunamadı." };
  const supabase = await createClient();
  const { error } = await supabase.from("message_sequences").delete().eq("id", id).eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Dizi silinemedi.") };
  revalidatePath(ROOT);
  return { ok: true };
}

/**
 * Müşterileri diziye kaydeder: tek tek seçilenler (`customer_ids`, JSON) ya da bir etiketin tüm müşterileri (`tag`).
 * Zaten aktif kayıtlı olan, silinmiş ya da kara listedeki müşteri atlanır. İlk adımın vadesi = şimdi + gecikmesi.
 */
export async function enrollInSequence(formData: FormData): Promise<SequenceActionResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  const sequenceId = String(formData.get("sequence_id") ?? "").trim();
  if (!UUID_RE.test(sequenceId)) return { error: "Dizi bulunamadı." };

  let ids: string[] = [];
  try {
    const raw = JSON.parse(String(formData.get("customer_ids") ?? "[]"));
    if (Array.isArray(raw)) ids = raw.map(String).filter((v) => UUID_RE.test(v));
  } catch {
    return { error: "Müşteri listesi okunamadı; seçimi temizleyip yeniden deneyin." };
  }
  const tag = String(formData.get("tag") ?? "").trim().slice(0, 50);
  if (ids.length === 0 && !tag) return { error: "En az bir müşteri ya da etiket seçin." };

  const supabase = await createClient();
  const [{ data: seq, error: seqErr }, { data: firstStep }] = await Promise.all([
    supabase.from("message_sequences").select("id").eq("id", sequenceId).eq("tenant_id", gate.tenantId).maybeSingle(),
    supabase
      .from("message_sequence_steps")
      .select("delay_days")
      .eq("sequence_id", sequenceId)
      .eq("tenant_id", gate.tenantId)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (missingTable(seqErr)) return { error: MISSING };
  if (!seq) return { error: "Dizi bulunamadı." };
  if (!firstStep) return { error: "Önce diziye en az bir adım ekleyin." };

  let q = supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .eq("blacklist", false);
  q = tag ? q.contains("tags", [tag]) : q.in("id", ids.slice(0, MAX_ENROLL_BATCH));
  const { data: customers, error: custErr } = await q.limit(MAX_ENROLL_BATCH);
  if (custErr) return { error: actionErrorMessage(custErr, "Müşteriler okunamadı.") };
  const candidates = (customers ?? []).map((c) => String(c.id));
  if (candidates.length === 0) return { error: tag ? "Bu etikette uygun müşteri bulunamadı." : "Seçilen müşteri bulunamadı." };

  const { data: existing } = await supabase
    .from("message_sequence_enrollments")
    .select("customer_id")
    .eq("tenant_id", gate.tenantId)
    .eq("sequence_id", sequenceId)
    .eq("status", "active")
    .in("customer_id", candidates);
  const already = new Set((existing ?? []).map((r) => String(r.customer_id)));
  const fresh = candidates.filter((c) => !already.has(c));
  if (fresh.length === 0) return { ok: true, enrolled: 0, skipped: candidates.length };

  const due = nextDueAt(Date.now(), Number(firstStep.delay_days ?? 0));
  const rows = fresh.map((customerId) => ({
    tenant_id: gate.tenantId,
    sequence_id: sequenceId,
    customer_id: customerId,
    status: "active",
    next_step: 0,
    next_due_at: due,
    enrolled_by: gate.userId,
  }));
  let enrolled = 0;
  const { error: insErr } = await supabase.from("message_sequence_enrollments").insert(rows);
  if (insErr) {
    if (insErr.code !== "23505") return { error: actionErrorMessage(insErr, "Kayıt yapılamadı.") };
    // Yarış: biri az önce kaydetti. Tek tek dene, çakışanı atla.
    for (const r of rows) {
      const { error } = await supabase.from("message_sequence_enrollments").insert(r);
      if (!error) enrolled += 1;
    }
  } else {
    enrolled = rows.length;
  }
  revalidatePath(`${ROOT}/${sequenceId}`);
  revalidatePath(ROOT);
  return { ok: true, enrolled, skipped: candidates.length - enrolled };
}

export async function stopEnrollment(id: string): Promise<SequenceActionResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Kayıt bulunamadı." };
  const supabase = await createClient();
  const ts = new Date().toISOString();
  const { data, error } = await supabase
    .from("message_sequence_enrollments")
    .update({ status: "stopped", stop_reason: "manual", finished_at: ts, next_due_at: null, updated_at: ts })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "active")
    .select("sequence_id")
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Durdurulamadı.") };
  if (!data) return { error: "Kayıt zaten durmuş ya da bulunamadı." };
  revalidatePath(`${ROOT}/${data.sequence_id}`);
  return { ok: true };
}
