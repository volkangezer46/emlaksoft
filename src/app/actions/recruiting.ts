"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { afterSafe } from "@/lib/after-safe";
import { notifyTenant } from "@/lib/notify";
import { now, parseTrLocalDateTime, trDayKey } from "@/lib/clock";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { CLOSED_RECRUIT_STAGES, isIsoDate, postgrestInList } from "@/lib/workflow-state";
import {
  RECRUIT_STAGE_LABEL,
  addDaysKey,
  isMissingRecruitSchema,
  isRecruitSource,
  isRecruitStage,
  orientationDueIso,
  parseExperience,
  parseTemplateRows,
} from "@/lib/recruiting/logic";
import { loadOrientationTemplate } from "@/lib/recruiting/store";

export type RecruitResult = { ok?: boolean; error?: string; info?: string; id?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_READY = "Danışman adayı ve oryantasyon özellikleri bu ortamda henüz etkin değil (kurulum bekliyor).";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function dbError(error: { code?: string; message?: string } | null, fallback: string): RecruitResult {
  return { error: isMissingRecruitSchema(error) ? NOT_READY : actionErrorMessage(error, fallback) };
}

function revalidateRecruit(candidateId?: string) {
  revalidatePath("/app/ekip/adaylar");
  if (candidateId) revalidatePath(`/app/ekip/adaylar/${candidateId}`);
}

/** İşe alım kapısı: aday verisi (KVKK) yalnız ekip yöneticisine (team:edit) açıktır; RLS aynı kuralı uygular. */
async function recruitGate() {
  return requirePermission("team", "edit");
}

type ContactParse = { ok: true; phone: string | null; email: string | null } | { ok: false; error: string };

function parseContact(fd: FormData): ContactParse {
  const phoneRaw = String(fd.get("phone") ?? "").trim();
  const emailRaw = String(fd.get("email") ?? "").trim();
  let phone: string | null = null;
  if (phoneRaw) {
    const parsed = parsePhoneStrict(phoneRaw);
    if (!parsed.ok) return { ok: false, error: parsed.error ?? PHONE_ERROR_MESSAGE };
    phone = parsed.stored;
  }
  let email: string | null = null;
  if (emailRaw) {
    if (!isValidEmail(emailRaw)) return { ok: false, error: EMAIL_ERROR_MESSAGE };
    email = normalizeEmail(emailRaw);
  }
  if (!phone && !email) return { ok: false, error: "Telefon ya da e-postadan en az birini girin." };
  return { ok: true, phone, email };
}

async function memberInTenant(supabase: Supabase, tenantId: string, profileId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, is_active")
    .eq("id", profileId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data as { id: string; full_name: string; is_active: boolean } | null;
}

/** Yeni aday (elle): ad + telefon/e-posta + kaynak; KVKK aydınlatmasının yapıldığı onaylanmadan kayıt açılmaz. */
export async function createCandidate(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };

  const fullName = String(fd.get("full_name") ?? "").trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 160) return { error: "Adayın adını ve soyadını girin." };
  const contact = parseContact(fd);
  if (!contact.ok) return { error: contact.error };
  if (String(fd.get("kvkk") ?? "") !== "on") return { error: "Adaya KVKK aydınlatmasının yapıldığını onaylayın." };
  const sourceRaw = String(fd.get("source") ?? "diger");
  const source = isRecruitSource(sourceRaw) ? sourceRaw : "diger";
  const ownerRaw = String(fd.get("owner_id") ?? "").trim();
  const ownerId = UUID_RE.test(ownerRaw) ? ownerRaw : gate.userId;

  const supabase = await createClient();
  if (contact.phone) {
    const { data: dup } = await supabase
      .from("recruit_candidates")
      .select("id, stage")
      .eq("tenant_id", gate.tenantId)
      .eq("phone", contact.phone)
      .not("stage", "in", postgrestInList(CLOSED_RECRUIT_STAGES))
      .limit(1)
      .maybeSingle();
    if (dup) return { error: "Bu telefonla açık bir aday kaydı zaten var.", id: String(dup.id) };
  }

  const { data, error } = await supabase
    .from("recruit_candidates")
    .insert({
      tenant_id: gate.tenantId,
      full_name: fullName,
      phone: contact.phone,
      email: contact.email,
      source,
      stage: "basvuru",
      owner_id: ownerId,
      experience_years: parseExperience(fd.get("experience_years")),
      current_office: String(fd.get("current_office") ?? "").trim().slice(0, 160) || null,
      message: String(fd.get("message") ?? "").trim().slice(0, 2000) || null,
      kvkk_consent_at: new Date(now()).toISOString(),
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !data) return dbError(error, "Aday kaydedilemedi.");

  await supabase.from("recruit_candidate_events").insert({
    tenant_id: gate.tenantId,
    candidate_id: data.id,
    actor_id: gate.userId,
    kind: "created",
    to_stage: "basvuru",
    body: "Aday elle eklendi.",
  });
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "recruit.candidate_created",
    entityType: "recruit_candidate",
    entityId: String(data.id),
    newValue: { source },
  });
  revalidateRecruit();
  return { ok: true, id: String(data.id), info: "Aday eklendi." };
}

/** Aday bilgilerini düzenle (ad, iletişim, kaynak, sorumlu, deneyim, mevcut ofis, özet not). */
export async function updateCandidate(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Aday bulunamadı." };
  const fullName = String(fd.get("full_name") ?? "").trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 160) return { error: "Adayın adını ve soyadını girin." };
  const contact = parseContact(fd);
  if (!contact.ok) return { error: contact.error };
  const sourceRaw = String(fd.get("source") ?? "diger");
  const ownerRaw = String(fd.get("owner_id") ?? "").trim();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recruit_candidates")
    .update({
      full_name: fullName,
      phone: contact.phone,
      email: contact.email,
      source: isRecruitSource(sourceRaw) ? sourceRaw : "diger",
      owner_id: UUID_RE.test(ownerRaw) ? ownerRaw : null,
      experience_years: parseExperience(fd.get("experience_years")),
      current_office: String(fd.get("current_office") ?? "").trim().slice(0, 160) || null,
      message: String(fd.get("message") ?? "").trim().slice(0, 2000) || null,
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return dbError(error, "Aday güncellenemedi.");
  if (!data) return { error: "Aday bulunamadı." };
  revalidateRecruit(id);
  return { ok: true, info: "Aday bilgileri kaydedildi." };
}

/** Aşama değiştir (olumsuz sonuçta neden zorunlu). Zaman çizelgesine aşama satırı düşer. */
export async function moveCandidateStage(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  const stage = String(fd.get("stage") ?? "");
  if (!UUID_RE.test(id)) return { error: "Aday bulunamadı." };
  if (!isRecruitStage(stage)) return { error: "Geçersiz aşama." };
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300);
  if (stage === "red" && !reason) return { error: "Olumsuz sonuç için bir neden seçin ya da yazın." };

  const supabase = await createClient();
  const { data: cur, error: readErr } = await supabase
    .from("recruit_candidates")
    .select("stage")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (readErr) return dbError(readErr, "Aday okunamadı.");
  if (!cur) return { error: "Aday bulunamadı." };
  if (cur.stage === stage) return { ok: true };

  const { error } = await supabase
    .from("recruit_candidates")
    .update({ stage, reject_reason: stage === "red" ? reason : null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return dbError(error, "Aşama değiştirilemedi.");
  await supabase.from("recruit_candidate_events").insert({
    tenant_id: gate.tenantId,
    candidate_id: id,
    actor_id: gate.userId,
    kind: "stage",
    from_stage: cur.stage,
    to_stage: stage,
    body: stage === "red" ? reason : null,
  });
  revalidateRecruit(id);
  return { ok: true, info: `Aday "${RECRUIT_STAGE_LABEL[stage]}" aşamasına alındı.` };
}

export async function addCandidateNote(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim().slice(0, 2000);
  if (!UUID_RE.test(id)) return { error: "Aday bulunamadı." };
  if (!body) return { error: "Not boş olamaz." };
  const supabase = await createClient();
  const { error } = await supabase.from("recruit_candidate_events").insert({
    tenant_id: gate.tenantId,
    candidate_id: id,
    actor_id: gate.userId,
    kind: "note",
    body,
  });
  if (error) return dbError(error, "Not eklenemedi.");
  // Hareket = aday canlı (KVKK saklama süresi hareketsizlikten sayılır).
  await supabase.from("recruit_candidates").update({ updated_at: new Date(now()).toISOString() }).eq("id", id).eq("tenant_id", gate.tenantId);
  revalidateRecruit(id);
  return { ok: true, info: "Not eklendi." };
}

export async function deleteCandidateNote(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  const candidateId = String(fd.get("candidate_id") ?? "").trim();
  if (!UUID_RE.test(id) || !UUID_RE.test(candidateId)) return { error: "Not bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recruit_candidate_events")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("actor_id", gate.userId)
    .eq("kind", "note")
    .select("id")
    .maybeSingle();
  if (error) return dbError(error, "Not silinemedi.");
  if (!data) return { error: "Yalnız kendi notunuzu silebilirsiniz." };
  revalidateRecruit(candidateId);
  return { ok: true, info: "Not silindi." };
}

/**
 * Görüşme planla: görüşmeyi yapacak kişiye GÖREV açılır (Görevler + takvim + hatırlatma mevcut altyapıdan), aday
 * kartına görüşme zamanı ve görev bağı yazılır; "Başvuru" aşamasındaki aday "Görüşme"ye geçer.
 */
export async function scheduleInterview(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Aday bulunamadı." };
  const at = parseTrLocalDateTime(String(fd.get("at") ?? ""));
  if (!at) return { error: "Görüşme tarihini ve saatini seçin." };
  if (at.getTime() < now() - 60 * 60_000) return { error: "Görüşme zamanı geçmişte olamaz." };
  const interviewerRaw = String(fd.get("interviewer_id") ?? "").trim();
  const interviewerId = UUID_RE.test(interviewerRaw) ? interviewerRaw : gate.userId;
  const place = String(fd.get("place") ?? "").trim().slice(0, 200);

  const supabase = await createClient();
  const [{ data: cand, error: readErr }, interviewer] = await Promise.all([
    supabase.from("recruit_candidates").select("id, full_name, phone, stage, interview_task_id").eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle(),
    memberInTenant(supabase, gate.tenantId, interviewerId),
  ]);
  if (readErr) return dbError(readErr, "Aday okunamadı.");
  if (!cand) return { error: "Aday bulunamadı." };
  if (!interviewer || !interviewer.is_active) return { error: "Görüşmeyi yapacak kişi bu ofisin aktif üyesi olmalı." };

  // Önceki açık görüşme görevi varsa yenisiyle çakışmasın: iptal edilir.
  if (cand.interview_task_id) {
    await supabase.from("tasks").update({ status: "cancelled" }).eq("id", cand.interview_task_id).eq("tenant_id", gate.tenantId).eq("status", "open");
  }
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .insert({
      tenant_id: gate.tenantId,
      title: `Danışman adayı görüşmesi: ${cand.full_name}`.slice(0, 200),
      notes: [place ? `Yer: ${place}` : null, "Aday kartı: Ekip > Danışman adayları"].filter(Boolean).join("\n"),
      kind: "other",
      priority: "high",
      status: "open",
      due_at: at.toISOString(),
      assigned_to: interviewerId,
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (taskErr || !task) return { error: actionErrorMessage(taskErr, "Görüşme görevi açılamadı.") };

  const nextStage = cand.stage === "basvuru" ? "gorusme" : cand.stage;
  const { error } = await supabase
    .from("recruit_candidates")
    .update({ interview_at: at.toISOString(), interview_task_id: task.id, stage: nextStage })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return dbError(error, "Görüşme kaydedilemedi.");

  const when = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(at);
  await supabase.from("recruit_candidate_events").insert({
    tenant_id: gate.tenantId,
    candidate_id: id,
    actor_id: gate.userId,
    kind: "interview",
    body: `${when} · ${interviewer.full_name}${place ? ` · ${place}` : ""}`,
    from_stage: nextStage !== cand.stage ? cand.stage : null,
    to_stage: nextStage !== cand.stage ? nextStage : null,
  });

  if (interviewerId !== gate.userId) {
    const tenantId = gate.tenantId;
    const taskId = String(task.id);
    afterSafe(
      () =>
        notifyTenant({
          tenantId,
          userId: interviewerId,
          title: "Danışman adayı görüşmesi planlandı",
          body: `${cand.full_name} · ${when}`,
          href: `/app/gorevler?gorev=${taskId}`,
          kind: "info",
        }),
      "recruit.interview_notify",
    );
  }
  revalidateRecruit(id);
  revalidatePath("/app/gorevler");
  return { ok: true, info: `Görüşme ${when} için planlandı; görev açıldı.` };
}

/**
 * Oryantasyonu başlat (iç yardımcı): şablon adımları üyeye kopyalanır; `asTasks` ise her adım üyeye görev olarak
 * açılır (son tarih = başlangıç + gün, 10:00). Üyenin zaten listesi varsa dokunulmaz.
 */
async function startOrientationFor(
  supabase: Supabase,
  input: { tenantId: string; actorId: string; profileId: string; startKey: string; asTasks: boolean },
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { data: existing, error: exErr } = await supabase
    .from("onboarding_items")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("profile_id", input.profileId)
    .limit(1);
  if (exErr) return { ok: false, error: isMissingRecruitSchema(exErr) ? NOT_READY : actionErrorMessage(exErr, "Oryantasyon okunamadı.") };
  if ((existing ?? []).length > 0) return { ok: false, error: "Bu üyenin oryantasyon listesi zaten var." };

  const template = await loadOrientationTemplate(supabase, input.tenantId);
  if (!template.available) return { ok: false, error: NOT_READY };

  let sort = 0;
  const rows: Record<string, unknown>[] = [];
  for (const item of template.items) {
    const dueOn = addDaysKey(input.startKey, item.offsetDays);
    let taskId: string | null = null;
    if (input.asTasks) {
      const { data: task } = await supabase
        .from("tasks")
        .insert({
          tenant_id: input.tenantId,
          title: `Oryantasyon: ${item.title}`.slice(0, 200),
          notes: item.description,
          kind: "other",
          priority: "normal",
          status: "open",
          due_at: orientationDueIso(dueOn),
          assigned_to: input.profileId,
          created_by: input.actorId,
        })
        .select("id")
        .single();
      taskId = task ? String(task.id) : null;
    }
    rows.push({
      tenant_id: input.tenantId,
      profile_id: input.profileId,
      title: item.title,
      description: item.description,
      due_on: dueOn,
      sort: sort++,
      task_id: taskId,
      created_by: input.actorId,
    });
  }
  const { error } = await supabase.from("onboarding_items").insert(rows);
  if (error) return { ok: false, error: isMissingRecruitSchema(error) ? NOT_READY : actionErrorMessage(error, "Oryantasyon başlatılamadı.") };
  return { ok: true, count: rows.length };
}

function notifyOrientation(tenantId: string, profileId: string, count: number) {
  afterSafe(
    () =>
      notifyTenant({
        tenantId,
        userId: profileId,
        title: "Hoş geldiniz! Oryantasyon listeniz hazır",
        body: `${count} adımlık başlangıç listeniz görevlerinize eklendi.`,
        href: `/app/ekip/${profileId}`,
        kind: "success",
      }),
    "recruit.orientation_notify",
  );
}

/**
 * Adayı ekip üyesiyle bağla: aday "Katıldı" olur, bağlı üye yazılır; istenirse üyenin oryantasyonu başlar.
 * Üye hesabı Ekip > Danışman ekle sihirbazıyla açılır (davet, rol, şube orada); bu adım ikisini birleştirir.
 */
export async function linkCandidateMember(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  const profileId = String(fd.get("profile_id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Aday bulunamadı." };
  if (!UUID_RE.test(profileId)) return { error: "Bağlanacak ekip üyesini seçin." };
  const startOrientation = String(fd.get("start_orientation") ?? "") === "on";

  const supabase = await createClient();
  const [{ data: cand, error: readErr }, member] = await Promise.all([
    supabase.from("recruit_candidates").select("id, stage, full_name").eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle(),
    memberInTenant(supabase, gate.tenantId, profileId),
  ]);
  if (readErr) return dbError(readErr, "Aday okunamadı.");
  if (!cand) return { error: "Aday bulunamadı." };
  if (!member) return { error: "Ekip üyesi bulunamadı." };

  const { error } = await supabase
    .from("recruit_candidates")
    .update({ profile_id: profileId, stage: "katildi", reject_reason: null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return dbError(error, "Aday bağlanamadı.");
  await supabase.from("recruit_candidate_events").insert({
    tenant_id: gate.tenantId,
    candidate_id: id,
    actor_id: gate.userId,
    kind: "joined",
    from_stage: cand.stage !== "katildi" ? cand.stage : null,
    to_stage: cand.stage !== "katildi" ? "katildi" : null,
    body: `${member.full_name} ekip üyesi olarak bağlandı.`,
  });

  let info = `${member.full_name} ekibe katıldı olarak işaretlendi.`;
  if (startOrientation) {
    const started = await startOrientationFor(supabase, {
      tenantId: gate.tenantId,
      actorId: gate.userId,
      profileId,
      startKey: trDayKey(now()),
      asTasks: true,
    });
    if (started.ok) {
      info += ` Oryantasyon başladı (${started.count} adım).`;
      notifyOrientation(gate.tenantId, profileId, started.count);
    } else {
      info += ` Oryantasyon başlatılamadı: ${started.error}`;
    }
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "recruit.candidate_joined",
    entityType: "recruit_candidate",
    entityId: id,
    newValue: { profile_id: profileId, orientation: startOrientation },
  });
  revalidateRecruit(id);
  revalidatePath(`/app/ekip/${profileId}`);
  return { ok: true, info };
}

/** KVKK silme: aday ve zaman çizelgesi kalıcı silinir (görüşme görevi görevlerde kalır). */
export async function deleteCandidate(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Aday bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("recruit_candidates").delete().eq("id", id).eq("tenant_id", gate.tenantId).select("id").maybeSingle();
  if (error) return dbError(error, "Aday silinemedi.");
  if (!data) return { error: "Aday bulunamadı." };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "recruit.candidate_deleted", entityType: "recruit_candidate", entityId: id });
  revalidateRecruit();
  return { ok: true, info: "Aday kaydı kalıcı olarak silindi." };
}

/** Kariyer formu ayarı: aç/kapat, giriş metni, KVKK saklama süresi (30-730 gün). */
export async function saveRecruitSettings(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const enabled = String(fd.get("form_enabled") ?? "") === "on";
  const intro = String(fd.get("intro") ?? "").trim().slice(0, 600) || null;
  const daysRaw = Number.parseInt(String(fd.get("retention_days") ?? "180"), 10);
  const retention = Number.isFinite(daysRaw) ? Math.min(730, Math.max(30, daysRaw)) : 180;
  const supabase = await createClient();
  const { error } = await supabase.from("recruit_settings").upsert(
    {
      tenant_id: gate.tenantId,
      form_enabled: enabled,
      intro,
      retention_days: retention,
      updated_by: gate.userId,
      updated_at: new Date(now()).toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return dbError(error, "Ayar kaydedilemedi.");
  revalidateRecruit();
  return { ok: true, info: enabled ? "Kariyer formu yayında." : "Kariyer formu kapatıldı." };
}

/** Bağlantıyı yenile: eski kariyer formu bağlantısı hemen geçersiz olur. */
export async function rotateRecruitFormToken(_prev: RecruitResult, _fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.from("recruit_settings").upsert(
    { tenant_id: gate.tenantId, form_token: crypto.randomUUID(), updated_by: gate.userId, updated_at: new Date(now()).toISOString() },
    { onConflict: "tenant_id" },
  );
  if (error) return dbError(error, "Bağlantı yenilenemedi.");
  revalidateRecruit();
  return { ok: true, info: "Yeni bağlantı oluşturuldu; eski bağlantı artık çalışmaz." };
}

/** Oryantasyon şablonunu kaydet (liste bütün olarak yazılır; boş liste = varsayılan şablona dön). */
export async function saveOrientationTemplate(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const rows = parseTemplateRows(fd.getAll("title"), fd.getAll("description"), fd.getAll("offset_days"));
  const reset = String(fd.get("reset") ?? "") === "1";
  if (!reset && rows.length === 0) return { error: "En az bir adım yazın." };
  const supabase = await createClient();
  const { error: delErr } = await supabase.from("onboarding_template_items").delete().eq("tenant_id", gate.tenantId);
  if (delErr) return dbError(delErr, "Şablon kaydedilemedi.");
  if (!reset) {
    const { error } = await supabase
      .from("onboarding_template_items")
      .insert(rows.map((r, i) => ({ tenant_id: gate.tenantId, title: r.title, description: r.description, offset_days: r.offsetDays, sort: i })));
    if (error) return dbError(error, "Şablon kaydedilemedi.");
  }
  revalidateRecruit();
  return { ok: true, info: reset ? "Varsayılan şablona dönüldü." : `Şablon kaydedildi (${rows.length} adım).` };
}

/** Danışman 360'tan oryantasyonu başlat (başlangıç günü seçilebilir; adımlar görev olarak atanabilir). */
export async function startOrientation(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const profileId = String(fd.get("profile_id") ?? "").trim();
  if (!UUID_RE.test(profileId)) return { error: "Ekip üyesi bulunamadı." };
  const startRaw = String(fd.get("start_on") ?? "").trim();
  const startKey = isIsoDate(startRaw) ? startRaw : trDayKey(now());
  const asTasks = String(fd.get("as_tasks") ?? "") === "on";
  const supabase = await createClient();
  const member = await memberInTenant(supabase, gate.tenantId, profileId);
  if (!member || !member.is_active) return { error: "Oryantasyon yalnız aktif ekip üyesi için başlatılır." };
  const started = await startOrientationFor(supabase, { tenantId: gate.tenantId, actorId: gate.userId, profileId, startKey, asTasks });
  if (!started.ok) return { error: started.error };
  if (profileId !== gate.userId) notifyOrientation(gate.tenantId, profileId, started.count);
  revalidatePath(`/app/ekip/${profileId}`);
  if (asTasks) revalidatePath("/app/gorevler");
  return { ok: true, info: `Oryantasyon başladı (${started.count} adım).` };
}

/** Adımı tamamlandı / açık işaretle: üyenin kendisi ya da ekip yöneticisi (tetik başka alanı kilitler). Bağlı görev eşlenir. */
export async function toggleOrientationItem(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await requirePermission("dashboard", "view", { write: true });
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  const done = String(fd.get("done") ?? "") === "1";
  if (!UUID_RE.test(id)) return { error: "Adım bulunamadı." };
  const supabase = await createClient();
  const stamp = new Date(now()).toISOString();
  const { data, error } = await supabase
    .from("onboarding_items")
    .update({ done_at: done ? stamp : null, done_by: done ? gate.userId : null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("profile_id, task_id")
    .maybeSingle();
  if (error) return dbError(error, "Adım güncellenemedi.");
  if (!data) return { error: "Adım bulunamadı." };
  if (data.task_id) {
    await supabase
      .from("tasks")
      .update(done ? { status: "done", completed_at: stamp } : { status: "open", completed_at: null })
      .eq("id", data.task_id)
      .eq("tenant_id", gate.tenantId)
      .neq("status", "cancelled");
  }
  revalidatePath(`/app/ekip/${String(data.profile_id)}`);
  revalidatePath("/app/performansim");
  return { ok: true };
}

/** Oryantasyonu kaldır: adımlar silinir, bağlı AÇIK görevler iptal edilir (tamamlananlar kalır). */
export async function removeOrientation(_prev: RecruitResult, fd: FormData): Promise<RecruitResult> {
  const gate = await recruitGate();
  if (!gate.ok) return { error: gate.error };
  const profileId = String(fd.get("profile_id") ?? "").trim();
  if (!UUID_RE.test(profileId)) return { error: "Ekip üyesi bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("onboarding_items")
    .delete()
    .eq("tenant_id", gate.tenantId)
    .eq("profile_id", profileId)
    .select("task_id");
  if (error) return dbError(error, "Oryantasyon kaldırılamadı.");
  const taskIds = ((data ?? []) as { task_id: string | null }[]).map((r) => r.task_id).filter((t): t is string => Boolean(t));
  if (taskIds.length > 0) {
    await supabase.from("tasks").update({ status: "cancelled" }).eq("tenant_id", gate.tenantId).in("id", taskIds).eq("status", "open");
  }
  revalidatePath(`/app/ekip/${profileId}`);
  return { ok: true, info: "Oryantasyon listesi kaldırıldı." };
}
