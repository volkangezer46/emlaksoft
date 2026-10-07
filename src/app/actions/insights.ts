"use server";

import { revalidatePath } from "next/cache";
import { daysFromNowIso } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isMissingSchemaError } from "@/lib/insights/facts";
import { normalizeInsightSettings } from "@/lib/insights/settings";
import { INSIGHT_DISMISS_REASONS, type InsightDismissReason, type InsightSettings } from "@/lib/insights/types";
import { actionErrorMessage } from "@/lib/action-errors";

export type InsightActionResult = { ok?: boolean; error?: string; taskId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTABLE = ["seen", "snoozed", "dismissed"] as const;
type SettableState = (typeof SETTABLE)[number];

const NOT_READY = "Öneriler henüz etkin değil (veritabanı güncellemesi bekleniyor).";

/**
 * İçgörü durumunu değiştirir (görüldü / ertele / yoksay). Yalnız ALICININ KENDİ satırı: kısıt veritabanındaki
 * `insight_set_state` RPC'sindedir (auth.uid() + tenant); doğrudan tablo güncellemesi kapalıdır.
 * Yetki: ana ekranı görme (dashboard:view) — içgörü kendi içgörüsüdür, ek veri açmaz.
 */
export async function setInsightState(
  insightId: string,
  state: SettableState,
  opts?: { reason?: InsightDismissReason; snoozeDays?: number },
): Promise<InsightActionResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(insightId)) return { error: "Geçersiz öneri." };
  if (!(SETTABLE as readonly string[]).includes(state)) return { error: "Geçersiz durum." };
  if (opts?.reason !== undefined && !(INSIGHT_DISMISS_REASONS as readonly string[]).includes(opts.reason)) {
    return { error: "Geçersiz yoksay nedeni." };
  }

  const snoozeDays = Math.min(30, Math.max(1, Math.trunc(opts?.snoozeDays ?? 1) || 1));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("insight_set_state", {
    p_id: insightId,
    p_state: state,
    p_reason: state === "dismissed" ? (opts?.reason ?? null) : null,
    p_snooze_until: state === "snoozed" ? daysFromNowIso(snoozeDays) : null,
    p_task_id: null,
  });
  if (error) {
    console.error("setInsightState", error.code);
    return { error: isMissingSchemaError(error) ? NOT_READY : actionErrorMessage(error, "Öneri güncellenemedi. Lütfen tekrar deneyin.") };
  }
  if (data !== true) return { error: "Öneri bulunamadı ya da zaten kapatılmış." };

  revalidatePath("/app");
  return { ok: true };
}

const KIND_TASK: Record<string, "call" | "followup" | "document"> = {
  call_priority: "call",
  deadline: "document",
};

/**
 * "Görevi aç": içgörüyü tek tıkla göreve çevirir ve içgörüyü `accepted` yapar (accepted_task_id bağlanır).
 * Otomatik DEĞİL: kullanıcı tıklar. Mükerrer koruması: aynı içgörü için açık görev varsa yenisi açılmaz,
 * mevcut görev bağlanır (notlardaki `[ins:<id8>]` izi, otomasyon motorundaki `[oto:...]` deseni).
 */
export async function acceptInsightAsTask(insightId: string): Promise<InsightActionResult> {
  const gate = await requirePermission("tasks", "create");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(insightId)) return { error: "Geçersiz öneri." };

  const supabase = await createClient();
  const { data: insight, error: readError } = await supabase
    .from("insights")
    .select("id, kind, severity, title, why, entity_type, entity_id, state")
    .eq("id", insightId)
    .eq("tenant_id", gate.tenantId)
    .eq("recipient_user_id", gate.userId)
    .maybeSingle();
  if (readError) return { error: isMissingSchemaError(readError) ? NOT_READY : actionErrorMessage(readError, "Öneri okunamadı.") };
  if (!insight) return { error: "Öneri bulunamadı." };
  if (insight.state === "dismissed" || insight.state === "accepted") return { error: "Bu öneri zaten kapatılmış." };

  const marker = `[ins:${insightId.slice(0, 8)}]`;
  const { data: existing } = await supabase
    .from("tasks")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open")
    .like("notes", `%${marker}%`)
    .limit(1)
    .maybeSingle();

  let taskId = existing?.id as string | undefined;
  if (!taskId) {
    const entityId = insight.entity_id as string | null;
    const link = {
      customer_id: insight.entity_type === "customer" ? entityId : null,
      property_id: insight.entity_type === "property" ? entityId : null,
      deal_id: insight.entity_type === "deal" ? entityId : null,
    };
    const { data: created, error: insertError } = await supabase
      .from("tasks")
      .insert({
        tenant_id: gate.tenantId,
        title: String(insight.title).slice(0, 200),
        notes: `${String(insight.why).slice(0, 800)}\n${marker}`,
        kind: KIND_TASK[insight.kind as string] ?? "followup",
        priority: insight.severity === "yuksek" ? "high" : "normal",
        status: "open",
        due_at: daysFromNowIso(1),
        assigned_to: gate.userId,
        created_by: gate.userId,
        ...link,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      console.error("acceptInsightAsTask", insertError?.code);
      return { error: actionErrorMessage(insertError, "Görev oluşturulamadı. Lütfen tekrar deneyin.") };
    }
    taskId = created.id as string;
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "task.create",
      entityType: "task",
      entityId: taskId,
      newValue: { source: "insight", insight_kind: insight.kind },
    });
  }

  const { data: ok, error: stateError } = await supabase.rpc("insight_set_state", {
    p_id: insightId,
    p_state: "accepted",
    p_reason: null,
    p_snooze_until: null,
    p_task_id: taskId,
  });
  if (stateError || ok !== true) {
    // Görev açıldı ama içgörü kapanamadı: kullanıcıya görevi söyle, tekrar tıklama mükerrer görev açmaz.
    return { ok: true, taskId, error: "Görev açıldı fakat öneri kapatılamadı." };
  }

  revalidatePath("/app");
  revalidatePath("/app/gorevler");
  return { ok: true, taskId };
}

/**
 * İçgörü ofis ayarları: sessize alınan kurallar + LLM anlatımı (varsayılan KAPALI). Yalnız ofis sahibi / genel müdür.
 * `oversight_settings.thresholds.insights` alanına yazar (ayrı tablo yok); diğer eşik alanlarına DOKUNMAZ.
 */
export async function saveInsightSettings(input: Partial<InsightSettings>): Promise<InsightActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.role !== "owner" && gate.role !== "gm") {
    return { error: "Ayarları yalnızca ofis sahibi veya genel müdür değiştirebilir." };
  }
  const next = normalizeInsightSettings(input);

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("oversight_settings")
    .select("thresholds, approval_rules")
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (readError) return { error: isMissingSchemaError(readError) ? NOT_READY : actionErrorMessage(readError, "Ayarlar okunamadı.") };

  const prev = row?.thresholds && typeof row.thresholds === "object" ? (row.thresholds as Record<string, unknown>) : {};
  const { error } = await supabase.from("oversight_settings").upsert(
    {
      tenant_id: gate.tenantId,
      thresholds: { ...prev, insights: next },
      approval_rules: row?.approval_rules ?? {},
      updated_by: gate.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return { error: actionErrorMessage(error, "Ayarlar kaydedilemedi.") };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "insight.settings_update",
    entityType: "oversight_settings",
    newValue: { muted_rules: next.mutedRules, narrative_enabled: next.narrativeEnabled },
  });
  revalidatePath("/app");
  return { ok: true };
}
