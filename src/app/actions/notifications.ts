"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { actionErrorMessage } from "@/lib/action-errors";
import { isMissingFunctionError, rpcKnownMissing, recordRpcOutcome } from "@/lib/supabase/rpc-probe";
import { parseNotificationCounts } from "@/lib/notification-text";

/**
 * Bildirim okuma/okundu eylemleri — okunma durumu KİŞİ BAŞINA `notification_reads` tablosunda (migration
 * 20261016050000). Ofis geneli bildirim (user_id NULL) her kullanıcı için ayrı okunur; salt okunur dahil herkes yazar.
 * Okundu eylemleri `requirePermission`'dan GEÇMEZ (sözleşme m: kişinin kendi okuma durumu iş verisi değildir);
 * kiracı + oturum kapısı `requireActiveTenant`, satır sınırı RLS (yalnız kendi satırı, yalnız görebildiği bildirim).
 * Okunmamış sayısı tek kaynaktan: `my_notification_counts()` (zil + /app/bildirimler aynı değer).
 * Migration yokken (tablo/RPC yok) eski tek-sütun (`notifications.read_at`) yoluna düşer.
 */

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
};

/** Zil akışı: en yeni 30 kayıt + GERÇEK okunmamış sayısı (listeden sayılmaz). */
export type NotificationFeed = { items: NotificationRow[]; unreadTotal: number };

export type NotificationReadResult = { ok: true } | { ok?: false; error: string };

const FEED_LIMIT = 30;
const FORM_MAX_IDS = 50;
const COUNTS_RPC = "my_notification_counts";
const MARK_RPC = "mark_my_notifications_read";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tablo/ilişki henüz yok (migration uygulanmadı): PostgREST ilişki/şema önbelleği ya da Postgres "relation yok". */
const RELATION_MISSING = new Set(["PGRST200", "PGRST205", "42P01"]);

type Gate = { userId: string; tenantId: string };
type Db = Awaited<ReturnType<typeof createClient>>;
type ReadEmbed = { read_at: string | null }[] | { read_at: string | null } | null;

function mineFilter(userId: string): string {
  return `user_id.eq.${userId},user_id.is.null`;
}

function embeddedReadAt(reads: ReadEmbed): string | null {
  if (!reads) return null;
  if (Array.isArray(reads)) return reads[0]?.read_at ?? null;
  return reads.read_at ?? null;
}

/** Eski yol (migration öncesi): okunma tek sütunda. */
async function legacyFeed(supabase: Db, gate: Gate): Promise<NotificationFeed> {
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, body, href, kind, read_at, created_at")
      .or(mineFilter(gate.userId))
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase.from("notifications").select("id", { count: "exact", head: true }).or(mineFilter(gate.userId)).is("read_at", null),
  ]);
  return { items: (data ?? []) as NotificationRow[], unreadTotal: count ?? 0 };
}

export async function listMyNotifications(): Promise<NotificationFeed> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { items: [], unreadTotal: 0 };
  const supabase = await createClient();
  if (rpcKnownMissing(COUNTS_RPC)) return legacyFeed(supabase, gate);

  const [list, counts] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, body, href, kind, created_at, reads:notification_reads(read_at)")
      .or(mineFilter(gate.userId))
      .eq("reads.user_id", gate.userId)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase.rpc(COUNTS_RPC),
  ]);
  recordRpcOutcome(COUNTS_RPC, counts.error);
  if (isMissingFunctionError(counts.error) || RELATION_MISSING.has(list.error?.code ?? "")) return legacyFeed(supabase, gate);

  const items: NotificationRow[] = ((list.data ?? []) as (Omit<NotificationRow, "read_at"> & { reads: ReadEmbed })[]).map(
    ({ reads, ...n }) => ({ ...n, read_at: embeddedReadAt(reads) }),
  );
  // Sayım okunamazsa (geçici hata) listedeki okunmamışlar en azından sıfırın altına düşmez.
  const unreadTotal = counts.error ? items.filter((n) => !n.read_at).length : parseNotificationCounts(counts.data).unread;
  return { items, unreadTotal };
}

/** Yalnız sayaç (ikinci cihazdaki toplu okuma sonrası zilin yeniden eşlenmesi). */
export async function getMyUnreadNotificationCount(): Promise<{ unread: number } | { error: string }> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  if (!rpcKnownMissing(COUNTS_RPC)) {
    const { data, error } = await supabase.rpc(COUNTS_RPC);
    recordRpcOutcome(COUNTS_RPC, error);
    if (!error) return { unread: parseNotificationCounts(data).unread };
    if (!isMissingFunctionError(error)) return { error: actionErrorMessage(error, "Bildirim sayısı okunamadı") };
  }
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .or(mineFilter(gate.userId))
    .is("read_at", null);
  if (error) return { error: actionErrorMessage(error, "Bildirim sayısı okunamadı") };
  return { unread: count ?? 0 };
}

/** ids = null → görebildiği tüm okunmamışlar. Tek tur (RPC); migration yoksa eski tek-sütun güncellemesi. */
async function markRead(ids: string[] | null, fallbackError: string): Promise<NotificationReadResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Ofis görüntüleme modunda bildirimler okundu işaretlenmez." };
  if (ids !== null && ids.length === 0) return { ok: true };
  const supabase = await createClient();

  if (!rpcKnownMissing(MARK_RPC)) {
    const { error } = await supabase.rpc(MARK_RPC, { p_ids: ids });
    recordRpcOutcome(MARK_RPC, error);
    if (!error) return { ok: true };
    if (!isMissingFunctionError(error)) return { error: actionErrorMessage(error, fallbackError) };
  }

  let q = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", gate.tenantId)
    .or(mineFilter(gate.userId))
    .is("read_at", null);
  if (ids) q = q.in("id", ids);
  const { error } = await q;
  if (error) return { error: actionErrorMessage(error, fallbackError) };
  return { ok: true };
}

function cleanIds(values: unknown[]): string[] {
  return [...new Set(values.map((v) => String(v ?? "").trim()).filter((v) => UUID_RE.test(v)))].slice(0, FORM_MAX_IDS);
}

/**
 * Zil paneli (istemci) çağırır: yol yeniden doğrulanmaz — zil durumu istemcide iyimser tutulur, diğer cihaz/sekme
 * 'reads:<uid>' yayınıyla eşlenir. Böylece her tıklama bütün /app önbelleğini düşürmez.
 */
export async function markNotificationRead(id: string): Promise<NotificationReadResult> {
  const ids = cleanIds([id]);
  if (ids.length === 0) return { error: "Bildirim bulunamadı; sayfayı yenileyip tekrar deneyin." };
  return markRead(ids, "Bildirim okundu işaretlenemedi");
}

export async function markAllNotificationsRead(): Promise<NotificationReadResult> {
  return markRead(null, "Bildirimler okundu işaretlenemedi");
}

/**
 * /app/bildirimler sayfasının form eylemleri. Gruplanmış satır ("× N") birden çok `id` gönderir; hepsi tek turda
 * okundu yazılır (en çok bir sayfa: 50). Sayfa kendini yeniler; zil yayınla eşlenir.
 */
export async function markNotificationReadForm(formData: FormData): Promise<NotificationReadResult> {
  const ids = cleanIds(formData.getAll("id"));
  if (ids.length === 0) return { error: "Bildirim bulunamadı; sayfayı yenileyip tekrar deneyin." };
  const result = await markRead(ids, "Bildirim okundu işaretlenemedi");
  if (result.ok) revalidatePath("/app/bildirimler");
  return result;
}

export async function markAllNotificationsReadForm(): Promise<NotificationReadResult> {
  const result = await markRead(null, "Bildirimler okundu işaretlenemedi");
  if (result.ok) revalidatePath("/app/bildirimler");
  return result;
}

/*
 * `notifyTenant` buradan src/lib/notify.ts'e TASINDI.
 *
 * Sebep: bu dosya "use server" tasiyor, yani buradan export edilen her
 * fonksiyon tarayicidan cagrilabilen bir UC NOKTA oluyor. notifyTenant
 * `tenantId`'yi parametre olarak aliyor ve createAdminClient() (service_role)
 * kullaniyordu — yani RLS'i atliyordu ve yetki kontrolu de yoktu. Action
 * kimligini ele geciren biri istedigi kiraciya bildirim yazdirabilirdi.
 *
 * lib/ altinda artik uc nokta degil; yalnizca sunucu kodu import edebiliyor.
 */

export async function subscribeToPush(sub: { endpoint: string; p256dh: string; auth: string }): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  if (!sub.endpoint || !sub.p256dh || !sub.auth) return { error: "Geçersiz abonelik" };

  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      tenant_id: gate.tenantId,
      user_id: gate.userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
    { onConflict: "endpoint" },
  );
  if (error) return { error: actionErrorMessage(error, "Anlık bildirim aboneliği kaydedilemedi") };
  return { ok: true };
}

export async function unsubscribeFromPush(endpoint: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", gate.userId);
  return { ok: true };
}
