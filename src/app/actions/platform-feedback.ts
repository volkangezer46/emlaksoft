"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { platformModuleMode } from "@/lib/platform-access";
import { logPlatformActivity } from "@/lib/platform-activity";
import { notifyTenant, notifyUsersBulk, type BulkNotifyItem } from "@/lib/notify";
import { checkRateLimit } from "@/lib/rate-limit";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, parseTrLocalDateTime } from "@/lib/clock";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import { resolveSegmentTenantIds, segmentFromForm } from "@/lib/platform-announcements/segment";
import { isRequestStatus, NPS_DEFAULT_QUESTION, REQUEST_STATUS_LABEL, type RequestStatus } from "@/lib/product-feedback/model";
import { changelogTargetHref } from "@/lib/product-feedback/store";

/**
 * ADMİN tarafı ürün geri bildirimi (DG8):
 *  - NPS anketi (Toplu duyuru > NPS anketi): AD8 segmentiyle hedef ofisler KAYIT ANINDA çözülür (banner deseni);
 *    kapı `broadcast` modülü + duyuru gönderebilen rol (süper admin / operasyon).
 *  - Öneri panosu (Destek > Öneri panosu): durum güncelleme (planlandı / yapılıyor / yayında ...), kapı `tickets`
 *    modülü yazma modu. Öneren ofisin sahibine/önerene uygulama içi bildirim gider; "Planlandı / Yapılıyor / Yayında"
 *    geçişinde oy veren HER ofise de (oy veren kullanıcı, yoksa ofis sahibi; ofis başına tek) bildirim gider (PA-10,
 *    döngüyü kapatma). "Yayında" öneri bir yenilik (changelog) girdisine bağlanabilir; bildirim o girdiye götürür.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlatformFeedbackResult = { ok?: boolean; error?: string; affected?: number; notified?: number };

/** Oy veren ofislere bildirim giden durumlar (öneren her durum değişikliğinde zaten haberdar olur). */
const VOTER_NOTIFY_STATUSES: readonly RequestStatus[] = ["planlandi", "yapiliyor", "yayinda"];
const VOTER_TITLE: Partial<Record<RequestStatus, string>> = {
  planlandi: "Oy verdiğiniz öneri planlandı",
  yapiliyor: "Oy verdiğiniz öneri üzerinde çalışılıyor",
  yayinda: "Oy verdiğiniz öneri yayında",
};

/**
 * Oy veren ofislerin alıcıları: oy veren kullanıcı (aktifse), yoksa ofis sahibi; ofis başına TEK satır. Öneren ofis
 * (kendi bildirimini ayrıca alır) hariç. Okunamazsa boş (durum güncellemesi bozulmaz).
 */
async function voterRecipients(admin: ReturnType<typeof createAdminClient>, requestId: string, exceptTenant: string): Promise<{ tenantId: string; userId: string }[]> {
  const votes: { tenant_id: string; user_id: string | null }[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin.from("product_feature_request_votes").select("tenant_id, user_id").eq("request_id", requestId).order("tenant_id").range(from, from + 999);
    if (error) return [];
    votes.push(...((data ?? []) as { tenant_id: string; user_id: string | null }[]));
    if ((data ?? []).length < 1000) break;
  }
  const byTenant = new Map<string, string | null>();
  for (const v of votes) if (v.tenant_id !== exceptTenant && !byTenant.has(v.tenant_id)) byTenant.set(v.tenant_id, v.user_id);
  if (byTenant.size === 0) return [];
  // Oy veren kullanıcı pasif/silinmişse ya da kaydı yoksa: ofis sahibi.
  const tenantIds = [...byTenant.keys()];
  const voterIds = [...new Set([...byTenant.values()].filter((u): u is string => Boolean(u)))];
  const active = new Set<string>();
  for (let i = 0; i < voterIds.length; i += 200) {
    const { data } = await admin.from("profiles").select("id").in("id", voterIds.slice(i, i + 200)).eq("is_active", true);
    for (const p of (data ?? []) as { id: string }[]) active.add(p.id);
  }
  const owners = new Map<string, string>();
  const needOwner = tenantIds.filter((t) => !byTenant.get(t) || !active.has(byTenant.get(t)!));
  for (let i = 0; i < needOwner.length; i += 200) {
    const { data } = await admin.from("profiles").select("id, tenant_id").in("tenant_id", needOwner.slice(i, i + 200)).eq("role", "owner").eq("is_active", true);
    for (const p of (data ?? []) as { id: string; tenant_id: string }[]) if (!owners.has(p.tenant_id)) owners.set(p.tenant_id, p.id);
  }
  const out: { tenantId: string; userId: string }[] = [];
  for (const t of tenantIds) {
    const voter = byTenant.get(t);
    const userId = voter && active.has(voter) ? voter : owners.get(t);
    if (userId) out.push({ tenantId: t, userId });
  }
  return out;
}

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
    updated_at: new Date(now()).toISOString(),
  };
  // Yayın durumu (is_active) yalnız setNpsSurveyActive ile değişir: kaldırılmış anketi düzenlemek onu sessizce
  // yeniden yayına almamalı.
  const res = id
    ? await admin.from("platform_nps_surveys").update(row).eq("id", id).select("id").maybeSingle()
    : await admin.from("platform_nps_surveys").insert({ ...row, is_active: true, created_by: staff.id }).select("id").single();
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

/**
 * Öneri durumunu, (isteğe bağlı) ofislere görünen notu ve "Yayında" için yenilik bağlantısını günceller. Durum değiştiyse
 * önerene, "Planlandı / Yapılıyor / Yayında" geçişinde oy veren tüm ofislere bildirim gider (yanıttan önce, toplu insert).
 */
export async function setFeatureRequestStatus(fd: FormData): Promise<PlatformFeedbackResult> {
  const staff = await requirePlatformModule("tickets");
  if (platformModuleMode(staff.role, "tickets") !== "write") return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz öneri." };
  const status = String(fd.get("status") ?? "");
  if (!isRequestStatus(status)) return { error: "Geçersiz durum." };
  const note = String(fd.get("admin_note") ?? "").trim();
  if (note.length > 600) return { error: "Not en fazla 600 karakter olabilir." };
  // Yenilik bağlantısı yalnız formda alan varsa işlenir (alan yoksa mevcut bağlantıya dokunulmaz).
  const hasChangelogField = fd.has("changelog_entry_id");
  const changelogRaw = String(fd.get("changelog_entry_id") ?? "").trim();
  if (changelogRaw && !UUID_RE.test(changelogRaw)) return { error: "Geçersiz yenilik." };
  if (changelogRaw && status !== "yayinda") return { error: "Yenilik bağlantısı yalnız 'Yayında' öneride kullanılır." };

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

  let changelog: { id: string; title: string; href: string | null } | null = null;
  if (changelogRaw) {
    const { data: entry, error: entryError } = await admin.from("changelog_entries").select("id, title, href, published_at").eq("id", changelogRaw).maybeSingle();
    if (entryError) return { error: actionErrorMessage(entryError, "Yenilik okunamadı") };
    const e = entry as { id: string; title: string; href: string | null; published_at: string | null } | null;
    if (!e || !e.published_at) return { error: "Seçilen yenilik bulunamadı ya da yayımlanmamış." };
    changelog = { id: e.id, title: e.title, href: e.href };
  }

  const changed = prev.status !== status;
  const nowIso = new Date(now()).toISOString();
  const patch: Record<string, unknown> = {
    status,
    admin_note: note || null,
    updated_at: nowIso,
    ...(changed ? { status_changed_at: nowIso, status_changed_by: staff.id } : {}),
  };
  // "Yayında" dışına çıkan öneri bağlantısını bırakır; alan varsa seçim yazılır.
  if (hasChangelogField || (changed && status !== "yayinda")) patch.changelog_entry_id = status === "yayinda" ? (changelog?.id ?? null) : null;
  let { error } = await admin.from("product_feature_requests").update(patch).eq("id", id);
  let linkSaved = "changelog_entry_id" in patch;
  if (error && linkSaved && isSchemaMissing(error)) {
    // Kolon henüz yok (migration 20261019070003 bekliyor): durum yine kaydedilir, bağlantı yazılmaz.
    delete patch.changelog_entry_id;
    linkSaved = false;
    ({ error } = await admin.from("product_feature_requests").update(patch).eq("id", id));
  }
  if (error) return { error: actionErrorMessage(error, "Öneri güncellenemedi") };
  await logPlatformActivity({
    actorId: staff.id,
    action: "feature_request.status",
    entityType: "feature_request",
    entityId: id,
    before: { status: prev.status, admin_note: prev.admin_note },
    after: { status, admin_note: note || null, ...(linkSaved ? { changelog_entry_id: changelog?.id ?? null } : {}) },
  });

  const target = status === "yayinda" ? (changelogTargetHref(changelog?.href) ?? "/app/yardim?sekme=oneriler") : "/app/yardim?sekme=oneriler";
  const shippedBody = changelog ? `${prev.title} · Yenilik: ${changelog.title}` : prev.title;
  let notified = 0;
  if (changed && status !== "yeni") {
    const ok = await notifyTenant({
      tenantId: prev.tenant_id,
      userId: prev.created_by,
      title: `Öneriniz: ${REQUEST_STATUS_LABEL[status]}`,
      body: status === "yayinda" ? shippedBody : prev.title,
      href: target,
      kind: status === "yayinda" ? "success" : "info",
      prefKey: "support",
    })
      .then(() => true)
      .catch(() => false);
    if (ok) notified += 1;
  }
  if (changed && VOTER_NOTIFY_STATUSES.includes(status)) {
    const recipients = await voterRecipients(admin, id, prev.tenant_id);
    const items: BulkNotifyItem[] = recipients.map((r) => ({
      key: r.tenantId,
      tenantId: r.tenantId,
      userId: r.userId,
      title: VOTER_TITLE[status] ?? `Oy verdiğiniz öneri: ${REQUEST_STATUS_LABEL[status]}`,
      body: status === "yayinda" ? shippedBody : prev.title,
      href: target,
      kind: status === "yayinda" ? "success" : "info",
      prefKey: "support",
      meta: { feature_request_id: id, status },
    }));
    const results = await notifyUsersBulk(admin, items);
    for (const r of results.values()) if (r.ok) notified += 1;
  }
  revalidatePath("/admin/tickets/oneriler");
  revalidatePath("/app/yardim");
  return { ok: true, notified };
}
