"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { notifyTenant } from "@/lib/notify";
import { afterSafe } from "@/lib/after-safe";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, trDayKey } from "@/lib/clock";
import { isMissingRelationError } from "@/lib/customer-contacts";
import { MAX_MENTIONS, MAX_PINNED_NOTES, NOTE_MAX_LENGTH } from "@/lib/customer-notes";

export type CustomerNoteResult = { ok?: boolean; error?: string; id?: string; notified?: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Müşteriye iç not yazar (CRM-G9) ve @anılan ekip arkadaşlarına müşteri kartına giden bildirim gönderir.
 * Kapı `customers:create` (iletişim kaydıyla aynı); anılan kimlikler bu ofisin AKTİF kullanıcıları olmalı (başka kimlik
 * sessizce atılır; kişi kendini anarsa bildirim gitmez). Anma kolonu yoksa (migration bekliyor) not yine yazılır.
 */
export async function createCustomerNote(customerId: string, body: string, mentionIds: string[] = []): Promise<CustomerNoteResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };
  const id = String(customerId ?? "").trim();
  const text = String(body ?? "").trim().slice(0, NOTE_MAX_LENGTH);
  if (!UUID_RE.test(id)) return { error: "Müşteri bulunamadı." };
  if (!text) return { error: "Not boş olamaz." };
  const wanted = [...new Set((Array.isArray(mentionIds) ? mentionIds : []).map(String).filter((m) => UUID_RE.test(m)))].slice(0, MAX_MENTIONS);

  const supabase = await createClient();
  const [{ data: customer }, membersRes, meRes] = await Promise.all([
    supabase.from("customers").select("id, full_name").eq("id", id).eq("tenant_id", gate.tenantId).is("deleted_at", null).maybeSingle(),
    wanted.length > 0
      ? supabase.from("profiles").select("id, full_name").eq("tenant_id", gate.tenantId).eq("is_active", true).in("id", wanted)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    wanted.length > 0
      ? supabase.from("profiles").select("full_name").eq("id", gate.userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!customer) return { error: "Müşteri bulunamadı." };
  const mentioned = ((membersRes.data ?? []) as { id: string }[]).map((m) => m.id);

  const base = { tenant_id: gate.tenantId, customer_id: id, created_by: gate.userId, channel: "note", direction: "internal", body: text };
  let res = await supabase.from("communications").insert({ ...base, mentioned_user_ids: mentioned }).select("id").single();
  if (res.error && isMissingRelationError(res.error)) {
    res = await supabase.from("communications").insert(base).select("id").single();
  }
  if (res.error || !res.data) {
    console.error("createCustomerNote", { code: res.error?.code });
    return { error: actionErrorMessage(res.error, "Not kaydedilemedi. Lütfen tekrar deneyin.") };
  }
  const noteId = res.data.id as string;

  const targets = mentioned.filter((m) => m !== gate.userId);
  if (targets.length > 0) {
    const name = (customer as { full_name: string }).full_name;
    const preview = text.length > 140 ? `${text.slice(0, 137)}…` : text;
    const who = (meRes.data as { full_name?: string | null } | null)?.full_name || "Bir ekip arkadaşınız";
    afterSafe(async () => {
      await Promise.all(
        targets.map((userId) =>
          notifyTenant({
            tenantId: gate.tenantId,
            userId,
            title: `${who} sizden bahsetti: ${name}`,
            body: preview,
            href: `/app/musteriler/${id}?sekme=ozet&notlar=bana#notlar`,
            kind: "info",
            dedupeKey: `note-mention:${noteId}:${userId}:${trDayKey()}`,
          }).catch((e: unknown) => console.error("not anma bildirimi", e instanceof Error ? e.message : e)),
        ),
      );
    }, "not anma bildirimi");
  }

  revalidatePath(`/app/musteriler/${id}`);
  return { ok: true, id: noteId, notified: targets.length };
}

/**
 * Notu sabitler / sabitlemeyi kaldırır (`customers:edit`). Müşteri başına en fazla `MAX_PINNED_NOTES` sabit not:
 * sınır doluysa en eski sabit not otomatik çözülür (kullanıcı ek adım atmaz).
 */
export async function setCustomerNotePinned(noteId: string, pinned: boolean): Promise<CustomerNoteResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(noteId ?? ""))) return { error: "Not bulunamadı." };
  const supabase = await createClient();
  const { data: note, error: readErr } = await supabase
    .from("communications")
    .select("id, customer_id, pinned_at")
    .eq("id", noteId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (readErr) {
    return { error: isMissingRelationError(readErr) ? "Not sabitleme için veritabanı güncellemesi henüz uygulanmamış." : actionErrorMessage(readErr, "Not okunamadı.") };
  }
  if (!note || !note.customer_id) return { error: "Not bulunamadı." };
  const customerId = note.customer_id as string;

  if (pinned) {
    const { data: current } = await supabase
      .from("communications")
      .select("id, pinned_at")
      .eq("customer_id", customerId)
      .eq("tenant_id", gate.tenantId)
      .not("pinned_at", "is", null)
      .neq("id", noteId)
      .order("pinned_at", { ascending: true });
    const overflow = (current ?? []).length - (MAX_PINNED_NOTES - 1);
    if (overflow > 0) {
      const unpin = (current ?? []).slice(0, overflow).map((r) => r.id as string);
      await supabase.from("communications").update({ pinned_at: null, pinned_by: null }).in("id", unpin).eq("tenant_id", gate.tenantId);
    }
  }
  const { error } = await supabase
    .from("communications")
    .update(pinned ? { pinned_at: new Date(now()).toISOString(), pinned_by: gate.userId } : { pinned_at: null, pinned_by: null })
    .eq("id", noteId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, pinned ? "Not sabitlenemedi." : "Sabitleme kaldırılamadı.") };
  revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true, id: noteId };
}
