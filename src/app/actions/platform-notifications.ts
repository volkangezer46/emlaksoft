"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStaff, requirePlatformModule, requirePlatformStaff } from "@/lib/platform";
import { notifyTenant } from "@/lib/notify";
import { afterSafe } from "@/lib/after-safe";
import { DAY_MS, now, parseTrLocalDateTime } from "@/lib/clock";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import { runAnnouncementQueue } from "@/lib/platform-announcements/run";
import { resolveSegmentRecipients, resolveSegmentTenantIds, segmentFromForm, type Segment } from "@/lib/platform-announcements/segment";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ComboboxOption } from "@/components/ui/combobox";
import { actionErrorMessage } from "@/lib/action-errors";

export async function markPlatformNotificationRead(id: string): Promise<{ ok: boolean }> {
  const staff = await requirePlatformStaff();
  if (!id) return { ok: false };
  const admin = createAdminClient();
  await admin
    .from("platform_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("staff_id", staff.id)
    .is("read_at", null);
  revalidatePath("/admin/bildirimler");
  return { ok: true };
}

export async function markAllPlatformNotificationsRead(): Promise<{ ok: boolean }> {
  const staff = await requirePlatformStaff();
  const admin = createAdminClient();
  await admin
    .from("platform_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("staff_id", staff.id)
    .is("read_at", null);
  revalidatePath("/admin/bildirimler");
  return { ok: true };
}

/** `<form action>` için void dönen sarmalayıcı. */
export async function markAllPlatformNotificationsReadForm(): Promise<void> {
  await markAllPlatformNotificationsRead();
}

/** `<form action>` için tekil okundu sarmalayıcısı (href'siz bildirim satırları). */
export async function markPlatformNotificationReadForm(formData: FormData): Promise<void> {
  await markPlatformNotificationRead(String(formData.get("id") ?? "").trim());
}

// ---------------------------------------------------------------------------
// Toplu duyuru (platform personelinden ofislere) — AD8 kuyruklu gönderim
// ---------------------------------------------------------------------------

export type BroadcastTarget = "all" | "trial" | "active" | "specific";

export type BroadcastResult = {
  ok?: boolean;
  error?: string;
  sent?: number;
  /** Kuyruğa alındıysa duyuru kimliği ve planlanan zaman. */
  id?: string;
  scheduledAt?: string | null;
  queued?: boolean;
};

const CHANNELS = ["in_app", "email", "push"] as const;
type Channel = (typeof CHANNELS)[number];

function canSend(role: string) {
  return ["super_admin", "ops"].includes(role);
}

/** Eski "Hedef kitle" seçicisinden (target + tenant_id) segment alanlarına köprü: eski form ve bağlantılar bozulmaz. */
function legacyTargetIntoForm(fd: FormData) {
  const target = String(fd.get("target") ?? "").trim();
  if (target === "trial" && fd.getAll("seg_status").length === 0) fd.append("seg_status", "trial");
  if (target === "active" && fd.getAll("seg_status").length === 0) fd.append("seg_status", "active");
  if (target === "specific" && !fd.get("seg_tenant")) {
    const t = String(fd.get("tenant_id") ?? "").trim();
    if (t) fd.set("seg_tenant", t);
  }
}

/** Arşivdeki audience sütunu: eski değerlerle uyumlu en dar etiket. */
function audienceOf(seg: Segment): "all" | "active" | "trial" | "specific" | "segment" | "user" {
  if (seg.userId) return "user";
  const keys = Object.keys(seg).filter((k) => k !== "ownersOnly" || seg.ownersOnly);
  if (keys.length === 0) return "all";
  if (keys.length === 1 && seg.tenantIds?.length === 1) return "specific";
  if (keys.length === 1 && seg.statuses?.length === 1 && seg.statuses[0] === "active") return "active";
  if (keys.length === 1 && seg.statuses?.length === 1 && seg.statuses[0] === "trial") return "trial";
  return "segment";
}

function parseHref(raw: FormDataEntryValue | null): { ok: true; value: string | null } | { ok: false; error: string } {
  const href = String(raw ?? "").trim();
  if (!href) return { ok: true, value: null };
  if (href.length > 500) return { ok: false, error: "Bağlantı en fazla 500 karakter olabilir." };
  if (/^\/[^/\\]/.test(href) || /^https:\/\/[^\s]+$/i.test(href)) return { ok: true, value: href };
  return { ok: false, error: "Bağlantı /app/... ile ya da https:// ile başlamalı." };
}

function parseLocal(raw: FormDataEntryValue | null, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, value: null };
  const d = parseTrLocalDateTime(s);
  if (!d) return { ok: false, error: `${label} geçersiz.` };
  return { ok: true, value: d.toISOString() };
}

/**
 * Duyuru oluşturur ve KUYRUĞA alır (AD8). İstek yalnız arşiv satırı yazar; teslim kuyrukta yapılır
 * (`src/lib/platform-announcements/queue.ts`): hemen gönderimde yanıt döndükten sonra afterSafe ile başlar, kalan
 * iş 2 dakikalık cron adımında biter — 200+ ofiste bile istek zaman aşımına düşmez.
 * Kanallar: uygulama içi (zil), e-posta (Resend; anahtar yoksa "kanal kapalı" raporlanır), push (VAPID).
 * Ticari ileti işaretliyse yalnız pazarlama iletisine AÇIKÇA izin veren kullanıcılara gider (İYS).
 * Migration henüz uygulanmadıysa eski anında (uygulama içi, ofis geneli) gönderime düşer.
 */
export async function sendBroadcast(fd: FormData): Promise<BroadcastResult> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role)) return { error: "Bu işlem için yetkiniz yok." };

  const sendRl = await checkRateLimit(`broadcast-send:${staff.id}`, { limit: 10, windowSec: 600, failurePolicy: "deny" });
  if (!sendRl.allowed) return { error: "Çok sık duyuru gönderdiniz; birkaç dakika sonra tekrar deneyin." };

  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim() || null;
  const kindRaw = String(fd.get("kind") ?? "info");
  const kind = (BROADCAST_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "info";
  if (!title) return { error: "Başlık zorunludur." };
  if (title.length > 120) return { error: "Başlık en fazla 120 karakter olabilir." };
  if (body && body.length > 2000) return { error: "Mesaj en fazla 2000 karakter olabilir." };
  const href = parseHref(fd.get("href"));
  if (!href.ok) return { error: href.error };

  const channelValues = fd.getAll("channel").map(String);
  const channels: Channel[] = (channelValues.length ? channelValues : ["in_app"]).filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
  if (channels.length === 0) return { error: "En az bir kanal seçin." };
  const commercial = fd.get("commercial") === "on";

  legacyTargetIntoForm(fd);
  const seg = segmentFromForm(fd);
  if (!seg.ok) return { error: seg.error };
  if (String(fd.get("target") ?? "") === "specific" && !seg.value.tenantIds) return { error: "Belirli ofis için ofis seçin." };

  const sched = parseLocal(fd.get("scheduled_at"), "Gönderim zamanı");
  if (!sched.ok) return { error: sched.error };
  const exp = parseLocal(fd.get("expires_at"), "Bitiş tarihi");
  if (!exp.ok) return { error: exp.error };
  const nowMs = now();
  if (sched.value && new Date(sched.value).getTime() > nowMs + 90 * DAY_MS) return { error: "Gönderim en çok 90 gün sonrasına planlanabilir." };
  const scheduledAt = sched.value && new Date(sched.value).getTime() > nowMs ? sched.value : new Date(nowMs).toISOString();
  if (exp.value && exp.value <= scheduledAt) return { error: "Bitiş tarihi gönderim zamanından sonra olmalı." };

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("platform_announcements")
    .insert({
      title,
      body,
      kind,
      href: href.value,
      audience: audienceOf(seg.value),
      tenant_id: seg.value.tenantIds?.length === 1 ? seg.value.tenantIds[0] : null,
      target_user_id: seg.value.userId ?? null,
      segment_json: seg.value,
      channels,
      commercial,
      scheduled_at: scheduledAt,
      expires_at: exp.value,
      status: "scheduled",
      sent_count: 0,
      created_by: staff.id,
    })
    .select("id")
    .single();

  if (error && isSchemaMissing(error)) {
    // Migration 20261013004700 uygulanmadı: eski anında gönderim (yalnız uygulama içi, ofis geneli, zamanlama yok).
    if (sched.value && new Date(sched.value).getTime() > nowMs) return { error: "Zamanlanmış gönderim için veritabanı güncellemesi bekleniyor." };
    return sendBroadcastLegacy(staff, admin, { title, body, kind, href: href.value, seg: seg.value });
  }
  if (error || !row) return { error: actionErrorMessage(error, "Duyuru kuyruğa alınamadı") };

  await logPlatformActivity({
    actorId: staff.id,
    action: "broadcast.send",
    entityType: "announcement",
    entityId: row.id,
    meta: { title, audience: audienceOf(seg.value), channels, scheduled_at: scheduledAt, commercial },
  });
  // Vakti gelmişse yanıt döndükten SONRA bu duyurunun kuyruğu başlar (küçük gönderim hemen biter).
  if (new Date(scheduledAt).getTime() <= nowMs + 1000) {
    afterSafe(() => runAnnouncementQueue({ announcementId: row.id, budgetMs: 20_000 }), "duyuru kuyruğu");
  }
  revalidatePath("/admin/duyuru");
  return { ok: true, queued: true, id: row.id, scheduledAt };
}

/** Eski yol (migration öncesi): ofis geneli uygulama içi bildirim, istek içinde. */
async function sendBroadcastLegacy(
  staff: { id: string },
  admin: ReturnType<typeof createAdminClient>,
  input: { title: string; body: string | null; kind: string; href: string | null; seg: Segment },
): Promise<BroadcastResult> {
  let query = admin.from("tenants").select("id").neq("status", "cancelled");
  if (input.seg.tenantIds) query = query.in("id", input.seg.tenantIds);
  if (input.seg.statuses?.length) query = query.in("status", input.seg.statuses);
  if (input.seg.plans?.length) query = query.in("plan", input.seg.plans);
  const { data: tenants, error: qErr } = await query;
  if (qErr) return { error: actionErrorMessage(qErr, "Hedef ofisler okunamadı") };
  if (!tenants || tenants.length === 0) return { error: "Eşleşen ofis bulunamadı." };
  const kind = input.kind as "info" | "success" | "warning" | "danger" | "system";
  let sent = 0;
  for (const t of tenants) {
    await notifyTenant({ tenantId: t.id, title: input.title, body: input.body ?? undefined, href: input.href ?? undefined, kind });
    sent++;
  }
  const legacyAudience = audienceOf(input.seg);
  const { error: archiveErr } = await admin.from("platform_announcements").insert({
    title: input.title,
    body: input.body,
    kind,
    audience: ["all", "active", "trial", "specific"].includes(legacyAudience) ? legacyAudience : "all",
    tenant_id: input.seg.tenantIds?.length === 1 ? input.seg.tenantIds[0] : null,
    sent_count: sent,
    created_by: staff.id,
  });
  if (archiveErr) console.error("duyuru arşivi yazılamadı", archiveErr);
  await logPlatformActivity({ actorId: staff.id, action: "broadcast.send", entityType: "announcement", meta: { title: input.title, sent } });
  revalidatePath("/admin/duyuru");
  return { ok: true, sent };
}

export type SegmentPreview = { ok?: boolean; error?: string; tenants?: number; recipients?: number; optedIn?: number };

/** Canlı sayım önizlemesi: segmentin ofis ve alıcı sayısı (gönderim anında yeniden çözülür). */
export async function previewBroadcastSegment(fd: FormData): Promise<SegmentPreview> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const rl = await checkRateLimit(`broadcast-preview:${staff.id}`, { limit: 120, windowSec: 60, failurePolicy: "allow" });
  if (!rl.allowed) return { error: "Çok sık sayım istendi." };
  legacyTargetIntoForm(fd);
  const seg = segmentFromForm(fd);
  if (!seg.ok) return { error: seg.error };
  const admin = createAdminClient();
  try {
    const tenantIds = await resolveSegmentTenantIds(admin, seg.value, now());
    const recipients = tenantIds.length ? await resolveSegmentRecipients(admin, seg.value, tenantIds) : [];
    return { ok: true, tenants: tenantIds.length, recipients: recipients.length, optedIn: recipients.filter((r) => r.marketingOptIn).length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sayım yapılamadı." };
  }
}

/** Başarısız teslimleri yeniden kuyruğa alır (ör. e-posta anahtarı sonradan girildi). */
export async function retryFailedDeliveries(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz duyuru." };
  const rl = await checkRateLimit(`broadcast-retry:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yeniden deneme; birkaç dakika sonra tekrar deneyin." };
  const admin = createAdminClient();
  const { data: a } = await admin.from("platform_announcements").select("id, status, expires_at").eq("id", id).maybeSingle();
  if (!a) return { error: "Duyuru bulunamadı." };
  if (a.status === "cancelled") return { error: "İptal edilmiş duyuru yeniden denenemez." };
  if (a.expires_at && new Date(a.expires_at).getTime() <= now()) return { error: "Bitiş tarihi geçmiş duyuru yeniden denenemez." };
  const nowIso = new Date(now()).toISOString();
  const { data: reset, error } = await admin
    .from("platform_announcement_deliveries")
    .update({ status: "pending", error: null, locked_at: null, updated_at: nowIso })
    .eq("announcement_id", id)
    .eq("status", "failed")
    .select("id");
  if (error) return { error: actionErrorMessage(error, "Yeniden deneme başlatılamadı.") };
  const affected = reset?.length ?? 0;
  if (affected > 0) {
    await admin.from("platform_announcements").update({ status: "sending", finished_at: null, updated_at: nowIso }).eq("id", id);
    afterSafe(() => runAnnouncementQueue({ announcementId: id, budgetMs: 20_000 }), "duyuru yeniden deneme");
  }
  await logPlatformActivity({ actorId: staff.id, action: "broadcast.retry", entityType: "announcement", entityId: id, meta: { affected } });
  revalidatePath("/admin/duyuru");
  return { ok: true, affected };
}

/** Henüz gönderilmemiş (zamanlanmış) duyuruyu iptal eder; bekleyen teslimler gitmez. */
export async function cancelScheduledBroadcast(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz duyuru." };
  const admin = createAdminClient();
  const nowIso = new Date(now()).toISOString();
  const { data, error } = await admin
    .from("platform_announcements")
    .update({ status: "cancelled", finished_at: nowIso, updated_at: nowIso })
    .eq("id", id)
    .in("status", ["scheduled", "sending"])
    .select("id")
    .maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Duyuru iptal edilemedi.") };
  if (!data) return { error: "Yalnız gönderimi sürmekte ya da zamanlanmış duyuru iptal edilebilir." };
  await admin
    .from("platform_announcement_deliveries")
    .update({ status: "expired", error: "Duyuru iptal edildi", updated_at: nowIso })
    .eq("announcement_id", id)
    .eq("status", "pending");
  await logPlatformActivity({ actorId: staff.id, action: "broadcast.cancel", entityType: "announcement", entityId: id });
  revalidatePath("/admin/duyuru");
  return { ok: true };
}

/** Doğrudan mesaj için ofisteki aktif kullanıcılar (Combobox araması). */
export async function searchTenantUsersBroadcast(tenantId: string, query: string): Promise<ComboboxOption[]> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role) || !UUID_RE.test(tenantId)) return [];
  const admin = createAdminClient();
  let q = admin.from("profiles").select("id, full_name, role").eq("tenant_id", tenantId).eq("is_active", true).order("full_name").limit(25);
  const s = query.trim();
  if (s.length >= 2) q = q.ilike("full_name", `%${s.replace(/[%_]/g, "")}%`);
  const { data } = await q;
  return ((data ?? []) as { id: string; full_name: string | null; role: string | null }[]).map((p) => ({
    value: p.id,
    label: p.full_name || "Adsız kullanıcı",
    hint: p.role === "owner" ? "Ofis sahibi" : (p.role ?? undefined),
  }));
}

// ---------------------------------------------------------------------------
// Banner / modal (ofis paneli üstü)
// ---------------------------------------------------------------------------

const BANNER_LEVELS = ["info", "warning", "critical"] as const;

/** Banner oluşturur/günceller. Hedef ofisler kayıt anında segmentten çözülür (boş segment = tüm ofisler). */
export async function saveBanner(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "").trim();
  if (id && !UUID_RE.test(id)) return { error: "Geçersiz banner." };
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim() || null;
  const level = String(fd.get("level") ?? "info");
  const display = fd.get("display") === "modal" ? "modal" : "banner";
  const dismissible = fd.get("dismissible") === "on";
  if (!title) return { error: "Başlık zorunludur." };
  if (title.length > 120) return { error: "Başlık en fazla 120 karakter olabilir." };
  if (body && body.length > 600) return { error: "Metin en fazla 600 karakter olabilir." };
  if (!(BANNER_LEVELS as readonly string[]).includes(level)) return { error: "Geçersiz seviye." };
  const href = parseHref(fd.get("href"));
  if (!href.ok) return { error: href.error };
  const starts = parseLocal(fd.get("starts_at"), "Başlangıç");
  if (!starts.ok) return { error: starts.error };
  const ends = parseLocal(fd.get("ends_at"), "Bitiş");
  if (!ends.ok) return { error: ends.error };
  const startsAt = starts.value ?? new Date(now()).toISOString();
  if (ends.value && ends.value <= startsAt) return { error: "Bitiş, başlangıçtan sonra olmalı." };
  const seg = segmentFromForm(fd);
  if (!seg.ok) return { error: seg.error };
  if (seg.value.userId) return { error: "Banner kullanıcıya değil ofise gösterilir." };

  const admin = createAdminClient();
  let tenantIds: string[] | null = null;
  if (Object.keys(seg.value).some((k) => k !== "ownersOnly")) {
    try {
      tenantIds = await resolveSegmentTenantIds(admin, seg.value, now());
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Hedef ofisler okunamadı." };
    }
    if (tenantIds.length === 0) return { error: "Segmentte ofis yok; banner kimseye görünmez." };
    if (tenantIds.length > 5000) return { error: "Hedef 5000 ofisi aşıyor; segmenti daraltın ya da tüm ofislere gösterin." };
  }
  const row = {
    title,
    body,
    level,
    display,
    dismissible,
    href: href.value,
    starts_at: startsAt,
    ends_at: ends.value,
    tenant_ids: tenantIds,
    segment_json: seg.value,
    is_active: true,
    updated_at: new Date(now()).toISOString(),
  };
  const res = id
    ? await admin.from("platform_banners").update(row).eq("id", id).select("id").maybeSingle()
    : await admin.from("platform_banners").insert({ ...row, created_by: staff.id }).select("id").single();
  if (res.error || !res.data) {
    if (isSchemaMissing(res.error)) return { error: "Banner tablosu henüz kurulmadı (veritabanı güncellemesi bekleniyor)." };
    return { error: actionErrorMessage(res.error, "Banner kaydedilemedi.") };
  }
  await logPlatformActivity({
    actorId: staff.id,
    action: id ? "banner.update" : "banner.create",
    entityType: "banner",
    entityId: res.data.id,
    meta: { title, level, display, dismissible, tenants: tenantIds?.length ?? "all" },
  });
  revalidatePath("/admin/duyuru");
  revalidatePath("/app", "layout");
  return { ok: true, affected: tenantIds?.length ?? 0 };
}

/** Banner'ı yayından kaldırır (is_active=false) ya da yeniden açar. */
export async function setBannerActive(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz banner." };
  const active = fd.get("active") === "1";
  const admin = createAdminClient();
  const { error } = await admin.from("platform_banners").update({ is_active: active, updated_at: new Date(now()).toISOString() }).eq("id", id);
  if (error) return { error: actionErrorMessage(error, "Banner güncellenemedi.") };
  await logPlatformActivity({ actorId: staff.id, action: active ? "banner.activate" : "banner.deactivate", entityType: "banner", entityId: id });
  revalidatePath("/admin/duyuru");
  revalidatePath("/app", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Yenilikler (changelog)
// ---------------------------------------------------------------------------

const CHANGELOG_CATEGORIES = ["yeni", "iyilestirme", "duzeltme"] as const;

/** Yenilik girdisi oluşturur/günceller. "Taslak" işaretliyse ofis panelinde görünmez; yayın zamanı ileri tarih olabilir. */
export async function saveChangelogEntry(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformModule("broadcast");
  if (!canSend(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "").trim();
  if (id && !UUID_RE.test(id)) return { error: "Geçersiz girdi." };
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim() || null;
  const category = String(fd.get("category") ?? "yeni");
  if (!title) return { error: "Başlık zorunludur." };
  if (title.length > 140) return { error: "Başlık en fazla 140 karakter olabilir." };
  if (body && body.length > 4000) return { error: "Metin en fazla 4000 karakter olabilir." };
  if (!(CHANGELOG_CATEGORIES as readonly string[]).includes(category)) return { error: "Geçersiz kategori." };
  const href = parseHref(fd.get("href"));
  if (!href.ok) return { error: href.error };
  const draft = fd.get("draft") === "on";
  const pub = parseLocal(fd.get("published_at"), "Yayın zamanı");
  if (!pub.ok) return { error: pub.error };
  const publishedAt = draft ? null : (pub.value ?? new Date(now()).toISOString());
  const admin = createAdminClient();
  const row = { title, body, category, href: href.value, published_at: publishedAt, updated_at: new Date(now()).toISOString() };
  const res = id
    ? await admin.from("changelog_entries").update(row).eq("id", id).select("id").maybeSingle()
    : await admin.from("changelog_entries").insert({ ...row, created_by: staff.id }).select("id").single();
  if (res.error || !res.data) {
    if (isSchemaMissing(res.error)) return { error: "Yenilikler tablosu henüz kurulmadı (veritabanı güncellemesi bekleniyor)." };
    return { error: actionErrorMessage(res.error, "Yenilik kaydedilemedi.") };
  }
  await logPlatformActivity({
    actorId: staff.id,
    action: id ? "changelog.update" : "changelog.create",
    entityType: "changelog",
    entityId: res.data.id,
    meta: { title, draft },
  });
  revalidatePath("/admin/duyuru");
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function deleteChangelogEntry(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformModule("broadcast");
  if (staff.role !== "super_admin") return { error: "Yenilik silme yalnız süper admin tarafından yapılabilir." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz girdi." };
  const admin = createAdminClient();
  const { error } = await admin.from("changelog_entries").delete().eq("id", id);
  if (error) return { error: actionErrorMessage(error, "Yenilik silinemedi.") };
  await logPlatformActivity({ actorId: staff.id, action: "changelog.delete", entityType: "changelog", entityId: id });
  revalidatePath("/admin/duyuru");
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Son gönderilen duyuruları listeler (platform_notifications değil, `broadcast_log` yerine
 *  admin client ile notifications tablosundan çekiyoruz — user_id IS NULL olanlar). */
export async function listRecentBroadcasts(limit = 20) {
  const staff = await requirePlatformStaff();
  if (!["super_admin", "ops"].includes(staff.role)) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("notifications")
    .select("id, title, body, kind, created_at, tenant_id")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * "Belirli ofis" hedefi için Combobox sunucu araması. UUID kopyala-yapıştır
 * yerine ad ile arama — admin client kullanılır, bu yüzden yetki kapısı şart:
 * duyuru gönderemeyen rol (support/billing) ofis listesini de tarayamaz.
 */
export async function searchTenantsBroadcast(query: string): Promise<ComboboxOption[]> {
  const staff = await getPlatformStaff();
  if (!staff || !["super_admin", "ops"].includes(staff.role)) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("id, name, slug, status")
    .neq("status", "cancelled")
    .ilike("name", `%${q}%`)
    .order("name")
    .limit(25);

  if (error || !data) return [];
  return data.map((t) => ({
    value: t.id,
    label: t.name,
    hint: `/${t.slug} · ${t.status}`,
  }));
}

// ---------------------------------------------------------------------------
// Duyuru düzenleme / silme (geri çekme)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BROADCAST_KINDS = ["info", "success", "warning", "danger", "system"] as const;

/**
 * Arşiv satırının gönderdiği bildirimleri bulur: `notifications` tablosunda duyuruya
 * bağ (FK) yoktur; aynı başlık/gövde/tür, kullanıcıya özel olmayan (user_id null) ve gönderim
 * penceresindeki satırlar eşleşir (gönderim döngüsü arşiv satırından önce biter).
 */
function matchSentNotifications(
  admin: ReturnType<typeof createAdminClient>,
  a: { title: string; body: string | null; kind: string; tenant_id: string | null; created_at: string },
) {
  const end = new Date(a.created_at).getTime();
  let q = admin
    .from("notifications")
    .select("id", { count: "exact" })
    .is("user_id", null)
    .eq("title", a.title)
    .eq("kind", a.kind)
    .gte("created_at", new Date(end - 15 * 60_000).toISOString())
    .lte("created_at", new Date(end + 60_000).toISOString());
  q = a.body === null ? q.is("body", null) : q.eq("body", a.body);
  if (a.tenant_id) q = q.eq("tenant_id", a.tenant_id);
  return q;
}

export type BroadcastEditResult = { ok?: boolean; error?: string; affected?: number };

/**
 * Duyurunun ofislere yazdığı bildirim kimlikleri: kuyruklu duyuruda teslim satırlarından (kesin bağ, AD8);
 * eski (migration öncesi) duyuruda başlık/gövde/zaman eşleşmesinden.
 */
async function sentNotificationIds(
  admin: ReturnType<typeof createAdminClient>,
  a: { id: string; title: string; body: string | null; kind: string; tenant_id: string | null; created_at: string },
): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin
      .from("platform_announcement_deliveries")
      .select("notification_id")
      .eq("announcement_id", a.id)
      .eq("channel", "in_app")
      .not("notification_id", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) break;
    for (const r of (data ?? []) as { notification_id: string }[]) ids.push(r.notification_id);
    if (!data || data.length < 1000) break;
  }
  if (ids.length > 0) return ids;
  const { data: sent } = await matchSentNotifications(admin, a);
  return (sent ?? []).map((r) => r.id as string);
}

/** `in("id", …)` sorgusunu URL sınırı aşılmasın diye 200'lük parçalarla çalıştırır; ilk hatayı döndürür. */
async function forChunks(ids: string[], run: (chunk: string[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await run(ids.slice(i, i + 200));
    if (error) return error;
  }
  return null;
}


/** Gönderilmiş duyurunun başlık/gövde/türünü arşivde ve ofislerin bildirim kutusunda düzeltir. */
export async function updateBroadcast(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformModule("broadcast");
  if (!["super_admin", "ops"].includes(staff.role)) return { error: "Bu işlem için yetkiniz yok." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz duyuru." };
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim() || null;
  const kind = String(fd.get("kind") ?? "info");
  if (!title) return { error: "Başlık zorunludur." };
  if (title.length > 120) return { error: "Başlık en fazla 120 karakter olabilir." };
  if (body && body.length > 2000) return { error: "Mesaj en fazla 2000 karakter olabilir." };
  if (!(BROADCAST_KINDS as readonly string[]).includes(kind)) return { error: "Geçersiz tür." };
  const rl = await checkRateLimit(`broadcast-edit:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık düzenleme yaptınız; birkaç dakika sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: a } = await admin
    .from("platform_announcements")
    .select("id, title, body, kind, tenant_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!a) return { error: "Duyuru bulunamadı." };

  const ids = await sentNotificationIds(admin, a);
  if (ids.length > 0) {
    const nErr = await forChunks(ids, (chunk) => admin.from("notifications").update({ title, body, kind }).in("id", chunk));
    if (nErr) {
      console.error("updateBroadcast notifications", nErr.message);
      return { error: "Ofis bildirimleri güncellenemedi; duyuru değiştirilmedi." };
    }
  }
  const { error } = await admin.from("platform_announcements").update({ title, body, kind }).eq("id", id);
  if (error) {
    console.error("updateBroadcast", error.message);
    return { error: actionErrorMessage(error, "Duyuru güncellenemedi.") };
  }
  await logPlatformActivity({
    actorId: staff.id,
    action: "broadcast.update",
    entityType: "announcement",
    entityId: id,
    meta: { affected: ids.length },
  });
  revalidatePath("/admin/duyuru");
  return { ok: true, affected: ids.length };
}

/** Duyuruyu geri çeker: ofislerin bildirim kutusundan siler ve arşiv satırını kaldırır. Yıkıcı: süper admin. */
export async function deleteBroadcast(fd: FormData): Promise<BroadcastEditResult> {
  const staff = await requirePlatformModule("broadcast");
  if (staff.role !== "super_admin") return { error: "Duyuru silme yalnız süper admin tarafından yapılabilir." };
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Geçersiz duyuru." };
  const rl = await checkRateLimit(`broadcast-delete:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık silme yaptınız; birkaç dakika sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: a } = await admin
    .from("platform_announcements")
    .select("id, title, body, kind, tenant_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!a) return { ok: true, affected: 0 };

  const ids = await sentNotificationIds(admin, a);
  if (ids.length > 0) {
    const nErr = await forChunks(ids, (chunk) => admin.from("notifications").delete().in("id", chunk));
    if (nErr) {
      console.error("deleteBroadcast notifications", nErr.message);
      return { error: "Ofis bildirimleri silinemedi; duyuru korunuyor." };
    }
  }
  const { error } = await admin.from("platform_announcements").delete().eq("id", id);
  if (error) {
    console.error("deleteBroadcast", error.message);
    return { error: actionErrorMessage(error, "Duyuru silinemedi.") };
  }
  await logPlatformActivity({
    actorId: staff.id,
    action: "broadcast.delete",
    entityType: "announcement",
    entityId: id,
    meta: { title: a.title, retracted: ids.length },
  });
  revalidatePath("/admin/duyuru");
  return { ok: true, affected: ids.length };
}
