"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { afterSafe } from "@/lib/after-safe";
import { notifyTenant } from "@/lib/notify";
import { now } from "@/lib/clock";
import { canCoach, parseCommitments, sanitizeSnapshot } from "@/lib/coaching/logic";

export type CoachingResult = { ok?: boolean; error?: string; info?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_READY = "Birebir görüşmeler bu ortamda henüz etkin değil (kurulum bekliyor).";

const missing = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /coaching_/.test(e.message ?? "")));

function paths(profileId: string) {
  revalidatePath(`/app/ekip/${profileId}`);
  revalidatePath("/app/performansim");
}

/**
 * Birebir görüşme kaydı (yönetici → danışman). Görüşme notu, o anki karne özeti (anlık görüntü), sonraki görüşme ve
 * taahhütler tek seferde yazılır; "görev olsun" işaretli taahhüt danışmana görev olarak açılır ve bağlanır.
 * Kapılar: team:view + yazma, yönetim rolü (owner/gm/branch_manager), kendisiyle görüşme yok; RLS aynı kuralı
 * (coaching_can_view + manager_id = oturum) uygular.
 */
export async function createCoachingSession(_prev: CoachingResult, fd: FormData): Promise<CoachingResult> {
  const gate = await requirePermission("team", "view", { write: true });
  if (!gate.ok) return { error: gate.error };
  if (!canCoach(gate.role)) return { error: "Birebir görüşmeyi ofis sahibi, genel müdür veya şube müdürü kaydeder." };

  const profileId = String(fd.get("profile_id") ?? "").trim();
  if (!UUID_RE.test(profileId)) return { error: "Danışman bulunamadı." };
  if (profileId === gate.userId) return { error: "Kendinizle birebir görüşme kaydedemezsiniz." };
  const notes = String(fd.get("notes") ?? "").trim().slice(0, 5000) || null;
  const nextRaw = String(fd.get("next_at") ?? "").trim();
  const nextAt = DAY_RE.test(nextRaw) ? nextRaw : null;
  const commitments = parseCommitments(fd.getAll("commitment"), fd.getAll("commitment_due"), fd.getAll("commitment_task"));
  if (!notes && commitments.length === 0) return { error: "Görüşme notu ya da en az bir taahhüt yazın." };
  const snapshot = sanitizeSnapshot(fd.get("snapshot"));

  const supabase = await createClient();
  const { data: member } = await supabase.from("profiles").select("id, full_name").eq("id", profileId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!member) return { error: "Danışman bulunamadı." };

  const { data: session, error } = await supabase
    .from("coaching_sessions")
    .insert({ tenant_id: gate.tenantId, profile_id: profileId, manager_id: gate.userId, notes, next_at: nextAt, snapshot })
    .select("id")
    .single();
  if (error || !session) return { error: missing(error) ? NOT_READY : actionErrorMessage(error, "Görüşme kaydedilemedi.") };

  let taskCount = 0;
  for (const c of commitments) {
    let taskId: string | null = null;
    if (c.asTask) {
      const { data: task } = await supabase
        .from("tasks")
        .insert({
          tenant_id: gate.tenantId,
          title: c.body.slice(0, 200),
          notes: "Birebir görüşme taahhüdü",
          kind: "followup",
          priority: "normal",
          status: "open",
          due_at: c.dueOn ? new Date(`${c.dueOn}T09:00:00+03:00`).toISOString() : null,
          assigned_to: profileId,
          created_by: gate.userId,
        })
        .select("id")
        .single();
      if (task) {
        taskId = task.id as string;
        taskCount += 1;
      }
    }
    await supabase.from("coaching_commitments").insert({
      tenant_id: gate.tenantId,
      session_id: session.id,
      profile_id: profileId,
      body: c.body,
      due_on: c.dueOn,
      task_id: taskId,
    });
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "coaching.session_created",
    entityType: "coaching_session",
    entityId: session.id,
    // Not içeriği denetim kaydına yazılmaz (çalışan verisi): yalnız sayılar.
    newValue: { profile_id: profileId, commitments: commitments.length, tasks: taskCount },
  });
  const tenantId = gate.tenantId;
  afterSafe(
    () =>
      notifyTenant({
        tenantId,
        userId: profileId,
        title: "Birebir görüşme kaydedildi",
        body: commitments.length ? `${commitments.length} taahhüt eklendi${taskCount ? `, ${taskCount} görev açıldı` : ""}.` : "Görüşme notunu Performansım'da görebilirsiniz.",
        href: "/app/performansim?sekme=birebir",
        kind: "info",
      }),
    "coaching.notify_advisor",
  );
  paths(profileId);
  return { ok: true, info: taskCount ? `Görüşme kaydedildi; ${taskCount} görev açıldı.` : "Görüşme kaydedildi." };
}

/** Taahhüdü tamamlandı / açık işaretle: danışmanın kendisi ya da görüşmeyi yapan yönetici (tetikleyici başka alanı kilitler). */
export async function toggleCoachingCommitment(_prev: CoachingResult, fd: FormData): Promise<CoachingResult> {
  const gate = await requirePermission("dashboard", "view", { write: true });
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  const done = String(fd.get("done") ?? "") === "1";
  if (!UUID_RE.test(id)) return { error: "Taahhüt bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coaching_commitments")
    .update({ done_at: done ? new Date(now()).toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("profile_id")
    .maybeSingle();
  if (error) return { error: missing(error) ? NOT_READY : actionErrorMessage(error, "Taahhüt güncellenemedi.") };
  if (!data) return { error: "Taahhüt bulunamadı." };
  paths(String(data.profile_id));
  return { ok: true };
}

/** Görüşmeyi sil: yalnız görüşmeyi yapan yönetici (RLS). Taahhütten açılmış görevler görevlerde kalır. */
export async function deleteCoachingSession(_prev: CoachingResult, fd: FormData): Promise<CoachingResult> {
  const gate = await requirePermission("team", "view", { write: true });
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Görüşme bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coaching_sessions")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("manager_id", gate.userId)
    .select("profile_id")
    .maybeSingle();
  if (error) return { error: missing(error) ? NOT_READY : actionErrorMessage(error, "Görüşme silinemedi.") };
  if (!data) return { error: "Yalnız görüşmeyi kaydeden yönetici silebilir." };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "coaching.session_deleted", entityType: "coaching_session", entityId: id });
  paths(String(data.profile_id));
  return { ok: true, info: "Görüşme silindi." };
}
