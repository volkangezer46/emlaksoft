"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { platformModuleMode } from "@/lib/platform-access";
import { logPlatformActivity } from "@/lib/platform-activity";
import { notifyTenant } from "@/lib/notify";
import { checkRateLimit } from "@/lib/rate-limit";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, parseTrLocalDateTime } from "@/lib/clock";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import { resolveSegmentTenantIds, segmentFromForm } from "@/lib/platform-announcements/segment";
import { isRequestStatus, NPS_DEFAULT_QUESTION, REQUEST_STATUS_LABEL } from "@/lib/product-feedback/model";

/**
 * ADMİN tarafı ürün geri bildirimi (DG8):
 *  - NPS anketi (Toplu duyuru > NPS anketi): AD8 segmentiyle hedef ofisler KAYIT ANINDA çözülür (banner deseni);
 *    kapı `broadcast` modülü + duyuru gönderebilen rol (süper admin / operasyon).
 *  - Öneri panosu (Destek > Öneri panosu): durum güncelleme (planlandı / yapılıyor / yayında ...), kapı `tickets`
 *    modülü yazma modu. Öneren ofisin sahibine/önerene uygulama içi bildirim gider.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlatformFeedbackResult = { ok?: boolean; error?: string; affected?: number };

function canSend(role: string) {
  return ["super_admin", "ops"].includes(role);
}

function parseLocal(raw: FormDataEntryValue | null, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, value: null };
  const d = parseTrLocalDateTime(s);
  return d ? { ok: true, value: d.toISOString() } : { ok: false, error: `${label} geçersiz.` };
}

// ---------------------------------------------------------------------------
// NPS anketi
// ---------------------------------------------------------------------------

/** Anket oluşturur/günceller. Boş segment = tüm ofisler; "yalnız sahipler" anketi ofis sahiplerine sınırlar. */
export async function saveNpsSurvey(fd: FormData): Promise<PlatformFeedbackResult> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const rl = await checkRateLimit(`nps-survey:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık kayıt; birkaç dakika sonra tekrar deneyin." };
  const id = String(fd.get("id") ?? "").trim();
  if (id && !UUID_RE.test(id)) return { error: "Geçersiz anket." };
  const question = String(fd.get("question") ?? "").trim() || NPS_DEFAULT_QUESTION;
  if (question.length < 10 || question.length > 200) return { error: "Soru 10-200 karakter olmalı." };
  const starts = parseLocal(fd.get("starts_at"), "Başlangıç");
  if (!starts.ok) return { error: starts.error };
  const ends = parseLocal(fd.get("ends_at"), "Bitiş");
  if (!ends.ok) return { error: ends.error };
  const startsAt = starts.value ?? new Date(now()).toISOString();
  if (ends.value && ends.value <= startsAt) return { error: "Bitiş, başlangıçtan sonra olmalı." };
  const seg = segmentFromForm(fd);
  if (!seg.ok) return { error: seg.error };
  if (seg.value.userId) return { error: "Anket tek kullanıcıya değil ofislere gösterilir." };

  const admin = createAdminClient();
  let tenantIds: string[] | null = null;
  if (Object.keys(seg.value).some((k) => k !== "ownersOnly")) {
    try {
      tenantIds = await resolveSegmentTenantIds(admin, seg.value, now());
    } catch (e) {
      return { error: actionErrorMessage(e, "Hedef ofisler okunamadı") };
    }
    if (tenantIds.length === 0) return { error: "Segmentte ofis yok; anket kimseye gösterilmez." };
    if (tenantIds.length > 5000) return { error: "Hedef 5000 ofisi aşıyor; segmenti daraltın ya da tüm ofislere gösterin." };
  }
  const row = {
    question,
    starts_at: startsAt,
    ends_at: ends.value,
    tenant_ids: tenantIds,
    owners_only: Boolean(seg.value.ownersOnly),
    segment_json: seg.value,
    is_active: true,
    updated_at: new Date(now()).toISOString(),
  };
  const res = id
    ? await admin.from("platform_nps_surveys").update(row).eq("id", id).select("id").maybeSingle()
    : await admin.from("platform_nps_surveys").insert({ ...row, created_by: staff.id }).select("id").single();
  if (res.error || !res.data) {
    if (isSchemaMissing(res.error)) return { error: "NPS tablosu henüz kurulmadı (veritabanı güncellemesi bekleniyor)." };
    return { error: actionErrorMessage(res.error, "Anket kaydedilemedi") };
  }
  await logPlatformActivity({
    actorId: staff.id,
    action: id ? "nps.update" : "nps.create",
    entityType: "nps_survey",
    entityId: res.data.id as string,
    meta: { tenants: tenantIds?.length ?? "all", owners_only: row.owners_only },
  });
  revalidatePath("/admin/duyuru");
  revalidatePath("/app", "layout");
  return { ok: true, affected: tenantIds?.length ?? 0 };
}

/** Anketi yayından kaldırır ya da yeniden açar (yanıtlar korunur). */
export async function setNpsSurveyActive(fd: FormData): Promise<PlatformFeedbackResult> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz anket." };
  const active = fd.get("active") === "1";
  const admin = createAdminClient();
  const { error } = await admin.from("platform_nps_surveys").update({ is_active: active, updated_at: new Date(now()).toISOString() }).eq("id", id);
  if (error) return { error: actionErrorMessage(error, "Anket güncellenemedi") };
  await logPlatformActivity({ actorId: staff.id, action: active ? "nps.activate" : "nps.deactivate", entityType: "nps_survey", entityId: id });
  revalidatePath("/admin/duyuru");
  revalidatePath("/app", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Öneri panosu
// ---------------------------------------------------------------------------

/** Öneri durumunu ve (isteğe bağlı) ofislere görünen notu günceller; durum değiştiyse önerene bildirim gider. */
export async function setFeatureRequestStatus(fd: FormData): Promise<PlatformFeedbackResult> {
  const staff = await requirePlatformModule("tickets");
  if (platformModuleMode(staff.role, "tickets") !== "write") return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz öneri." };
  const status = String(fd.get("status") ?? "");
  if (!isRequestStatus(status)) return { error: "Geçersiz durum." };
  const note = String(fd.get("admin_note") ?? "").trim();
  if (note.length > 600) return { error: "Not en fazla 600 karakter olabilir." };

  const admin = createAdminClient();
  const { data: before, error: readError } = await admin
    .from("product_feature_requests")
    .select("id, tenant_id, created_by, title, status, admin_note")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    if (isSchemaMissing(readError)) return { error: "Öneri panosu henüz kurulmadı (veritabanı güncellemesi bekleniyor)." };
    return { error: actionErrorMessage(readError, "Öneri okunamadı") };
  }
  const prev = before as { id: string; tenant_id: string; created_by: string | null; title: string; status: string; admin_note: string | null } | null;
  if (!prev) return { error: "Öneri bulunamadı." };
  const changed = prev.status !== status;
  const nowIso = new Date(now()).toISOString();
  const { error } = await admin
    .from("product_feature_requests")
    .update({
      status,
      admin_note: note || null,
      updated_at: nowIso,
      ...(changed ? { status_changed_at: nowIso, status_changed_by: staff.id } : {}),
    })
    .eq("id", id);
  if (error) return { error: actionErrorMessage(error, "Öneri güncellenemedi") };
  await logPlatformActivity({
    actorId: staff.id,
    action: "feature_request.status",
    entityType: "feature_request",
    entityId: id,
    before: { status: prev.status, admin_note: prev.admin_note },
    after: { status, admin_note: note || null },
  });
  if (changed && status !== "yeni") {
    await notifyTenant({
      tenantId: prev.tenant_id,
      userId: prev.created_by,
      title: `Öneriniz: ${REQUEST_STATUS_LABEL[status]}`,
      body: prev.title,
      href: "/app/yardim?sekme=oneriler",
      kind: status === "yayinda" ? "success" : "info",
    }).catch(() => undefined);
  }
  revalidatePath("/admin/tickets/oneriler");
  revalidatePath("/app/yardim");
  return { ok: true };
}
