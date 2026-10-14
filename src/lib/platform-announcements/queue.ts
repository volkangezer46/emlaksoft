import type { SupabaseClient } from "@supabase/supabase-js";
import { getBaseUrl } from "@/lib/base-url";
import { now } from "@/lib/clock";
import { EMAIL_BATCH_MAX, resolveEmailChannelConfig, sendEmailBatch, type ResolvedEmailConfig } from "@/lib/email/provider";
import { pushConfigured, sendPushToUser } from "@/lib/push";
import { notifyUsersBulk, type BulkNotifyItem } from "@/lib/notify";
import { parseSegment, resolveSegmentRecipients, resolveSegmentTenantIds } from "./segment";

/**
 * Duyuru KUYRUĞU (AD8). Gönderim isteği yalnız arşiv satırı yazar (status='scheduled'); teslim burada yapılır:
 *   1) vakti gelen duyuru sahiplenilir (status scheduled -> sending, koşullu UPDATE: iki çalıştırma aynı satırı alamaz),
 *      segment GÖNDERİM ANINDA çözülür ve alıcı x kanal başına teslim satırı yazılır (benzersiz anahtar: tekrar güvenli);
 *   2) bekleyen teslimler `platform_announcement_claim` (FOR UPDATE SKIP LOCKED) ile partiler halinde alınır ve gönderilir;
 *   3) bekleyeni kalmayan duyuru kapanır: hatasız 'sent', başarısız alıcı varsa 'partial' (arşivde "yeniden dene").
 * Çalıştırıcılar: campaign-delivery cron'unun ayrık adımı (2 dk) + gönderim anında after() (küçük gönderim hemen gider).
 * Süre bütçesi parti İÇİNDE de denetlenir: bütçe bitince henüz gönderilmemiş satırlar denenmeden 'pending'e döner
 * (deneme sayılmaz) ve bir sonraki çalıştırmaya kalır. Bütçe yalnız o an uçuşta olan tek dış isteğin zaman aşımı
 * kadar (e-posta 15 sn, push 8 sn) aşılabilir; yeni istek bütçe bittikten sonra başlatılmaz.
 *
 * E-posta: Resend TOPLU uç noktası (istek başına 100 ileti), adresler parti başına tek RPC ile, kanal ayarı çalıştırma
 * başına bir kez okunur; istekler `emailRatePerSec` ile kısılır (süreç geneli). Sağlayıcı 429/5xx derse satır 'failed'
 * DEĞİL, geri çekilmeyle (not_before) 'pending'e döner; MAX_ATTEMPTS denemeden sonra 'failed'. 429'da partinin kalan
 * e-postaları denenmeden ertelenir (aynı sınıra tekrar çarpılmaz).
 *
 * Dış kanallar anahtar yokken KAPALI: e-posta (Resend) ve push (VAPID) teslimi istek atmadan 'failed' + "Kanal kapalı: ..."
 * olarak raporlanır (sahte gönderim yok); anahtar girildikten sonra arşivden "yeniden dene" ile gider.
 * Ticari ileti (İYS): yalnız bildirim tercihinde "pazarlama" AÇIKÇA açık kullanıcıya gider; diğerleri 'skipped'.
 *
 * Bu dosya service_role istemcisi OLUŞTURMAZ; çağıranın istemcisini alır.
 */

export type QueueSummary = {
  materialized: number;
  delivered: number;
  failed: number;
  skipped: number;
  finished: number;
  budgetHit: boolean;
  /** Geçici hata ya da bütçe nedeniyle yeniden kuyruğa dönen satırlar. */
  retrying?: number;
  schemaMissing?: boolean;
};

export type DeliveryChannel = "in_app" | "email" | "push";
export const DELIVERY_CHANNELS: readonly DeliveryChannel[] = ["in_app", "email", "push"];

type AnnouncementRow = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  href: string | null;
  channels: string[];
  segment_json: unknown;
  commercial: boolean;
  status: string;
  expires_at: string | null;
  scheduled_at: string | null;
};

type DeliveryRow = {
  id: string;
  announcement_id: string;
  tenant_id: string;
  user_id: string;
  channel: DeliveryChannel;
  status: string;
  attempts: number;
  error: string | null;
  notification_id: string | null;
  provider_id: string | null;
  sent_at: string | null;
};

const ANN_COLS = "id, title, body, kind, href, channels, segment_json, commercial, status, expires_at, scheduled_at";

/** Şema yok (migration uygulanmadı) hatası mı? Kuyruk sessizce atlar. */
export function isSchemaMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "42703" || error.code === "PGRST200" || error.code === "PGRST202" || error.code === "PGRST204" || error.code === "PGRST205"
    || /does not exist|could not find/i.test(error.message ?? "");
}

/** Tıklama ölçüm bağlantısı (bildirim ve e-posta). Duyurunun bağlantısı yoksa ölçüm de yok. */
export function trackingPath(deliveryId: string): string {
  return `/api/duyuru/tik?d=${deliveryId}`;
}

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** SAF: teslim satırları (alıcı x kanal). Ticari ileti izni olmayan alıcı 'skipped' yazılır (raporda görünür). */
export function buildDeliveryRows(
  announcementId: string,
  channels: readonly string[],
  commercial: boolean,
  recipients: readonly { tenantId: string; userId: string; marketingOptIn: boolean }[],
) {
  const rows: { announcement_id: string; tenant_id: string; user_id: string; channel: DeliveryChannel; status: string; error: string | null }[] = [];
  const valid = DELIVERY_CHANNELS.filter((c) => channels.includes(c));
  for (const r of recipients) {
    for (const channel of valid) {
      const blocked = commercial && !r.marketingOptIn;
      rows.push({
        announcement_id: announcementId,
        tenant_id: r.tenantId,
        user_id: r.userId,
        channel,
        status: blocked ? "skipped" : "pending",
        error: blocked ? "Ticari ileti izni yok (İYS)" : null,
      });
    }
  }
  return rows;
}

/** Duyurunun segmentini çözüp teslim satırlarını yazar. Döner: yazılan satır sayısı. */
async function materialize(admin: SupabaseClient, a: AnnouncementRow): Promise<number> {
  const seg = parseSegment(a.segment_json);
  const update = async (patch: Record<string, unknown>) => {
    await admin.from("platform_announcements").update({ ...patch, updated_at: new Date(now()).toISOString() }).eq("id", a.id);
  };
  if (!seg.ok) {
    await update({ status: "partial", finished_at: new Date(now()).toISOString(), materialized_at: new Date(now()).toISOString(), stats: { error: seg.error } });
    return 0;
  }
  const tenantIds = await resolveSegmentTenantIds(admin, seg.value, now());
  const recipients = tenantIds.length ? await resolveSegmentRecipients(admin, seg.value, tenantIds) : [];
  const rows = buildDeliveryRows(a.id, a.channels, a.commercial, recipients);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("platform_announcement_deliveries")
      .upsert(rows.slice(i, i + 500), { onConflict: "announcement_id,channel,user_id", ignoreDuplicates: true });
    if (error) throw new Error(`Teslim satırları yazılamadı: ${error.message}`);
  }
  const reached = new Set(recipients.map((r) => r.tenantId)).size;
  await update({ materialized_at: new Date(now()).toISOString(), recipient_count: recipients.length, sent_count: reached });
  return rows.length;
}

/** Vakti gelen duyuruları sahiplenir ve teslim satırlarını yazar. */
async function claimDueAnnouncements(admin: SupabaseClient, onlyId?: string): Promise<{ count: number; schemaMissing: boolean }> {
  const nowIso = new Date(now()).toISOString();
  const staleIso = new Date(now() - 10 * 60_000).toISOString();
  let q = admin
    .from("platform_announcements")
    .select(ANN_COLS)
    .or(`and(status.eq.scheduled,scheduled_at.lte.${nowIso}),and(status.eq.sending,materialized_at.is.null,started_at.lt.${staleIso})`)
    .order("scheduled_at", { ascending: true })
    .limit(5);
  if (onlyId) q = q.eq("id", onlyId);
  const { data, error } = await q;
  if (error) return { count: 0, schemaMissing: isSchemaMissing(error) };
  let count = 0;
  for (const a of (data ?? []) as AnnouncementRow[]) {
    // Koşullu sahiplenme: aynı anda çalışan diğer çalıştırma bu satırı alamaz.
    const { data: claimed } = await admin
      .from("platform_announcements")
      .update({ status: "sending", started_at: nowIso, updated_at: nowIso })
      .eq("id", a.id)
      .eq("status", a.status)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    if (a.expires_at && new Date(a.expires_at).getTime() <= now()) {
      await admin.from("platform_announcements").update({ status: "expired", finished_at: nowIso, updated_at: nowIso }).eq("id", a.id);
      continue;
    }
    count += await materialize(admin, a);
  }
  return { count, schemaMissing: false };
}

/**
 * retry: denendi, geçici hata (429/5xx) → geri çekilmeyle yeniden bekler (deneme sayılır).
 * deferred: hiç denenmedi (bütçe bitti / partide 429 alındı) → bekler, deneme sayılmaz.
 */
type Outcome = {
  status: "sent" | "failed" | "skipped" | "expired" | "retry" | "deferred";
  error?: string | null;
  notificationId?: string | null;
  providerId?: string | null;
  /** retry/deferred: bu süre geçmeden yeniden alınmaz (ms). */
  backoffMs?: number;
};

/** Geçici hatada en çok deneme sayısı (sahiplenme her alımda attempts'i artırır). */
export const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 60_000;

type RunCtx = {
  deadline: number;
  emailRatePerSec: number;
  sleep: (ms: number) => Promise<void>;
  /** Çalıştırma başına bir kez çözülür (öğe başına ayar okuması yok). */
  emailConfig?: Promise<ResolvedEmailConfig>;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** E-posta isteği kısıcı: SÜREÇ geneli (cron + after() aynı süreçte aynı sınırı paylaşır). */
let emailNextAt = 0;
async function emailThrottle(ctx: RunCtx): Promise<void> {
  const interval = Math.ceil(1000 / Math.max(0.1, ctx.emailRatePerSec));
  const wait = Math.min(emailNextAt - now(), interval); // saat geri giderse en çok bir aralık beklenir
  if (wait > 0) await ctx.sleep(wait);
  emailNextAt = Math.max(now(), emailNextAt) + interval;
}

/** Eşzamanlılık sınırlı eşleme; süre bitince kalan öğeler `onExpired` ile (denenmeden) sonuçlanır. */
async function mapLimit<T, R>(items: readonly T[], limit: number, deadline: number, fn: (item: T) => Promise<R>, onExpired: (item: T) => R): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = now() >= deadline ? onExpired(items[i]) : await fn(items[i]);
      }
    }),
  );
  return out;
}

const DEFERRED_BUDGET: Outcome = { status: "deferred", error: null };

async function deliverInApp(admin: SupabaseClient, rows: DeliveryRow[], ann: Map<string, AnnouncementRow>): Promise<Map<string, Outcome>> {
  const result = new Map<string, Outcome>();
  const items = rows.map((d) => {
    const a = ann.get(d.announcement_id)!;
    return {
      key: d.id,
      tenantId: d.tenant_id,
      userId: d.user_id,
      title: a.title,
      body: a.body ?? undefined,
      href: a.href ? trackingPath(d.id) : undefined,
      kind: (["info", "success", "warning", "danger", "system"].includes(a.kind) ? a.kind : "info") as BulkNotifyItem["kind"],
      prefKey: a.commercial ? ("marketing" as const) : undefined,
      meta: { pad: d.id },
    };
  });
  const res = await notifyUsersBulk(admin, items);
  for (const d of rows) {
    const r = res.get(d.id);
    if (!r) result.set(d.id, { status: "failed", error: "Bildirim yazılamadı" });
    else if (r.ok) result.set(d.id, { status: "sent", notificationId: r.notificationId });
    else result.set(d.id, { status: r.skipped ? "skipped" : "failed", error: clip(r.error) });
  }
  return result;
}

async function deliverEmail(admin: SupabaseClient, rows: DeliveryRow[], ann: Map<string, AnnouncementRow>, ctx: RunCtx): Promise<Map<string, Outcome>> {
  const result = new Map<string, Outcome>();
  ctx.emailConfig ??= resolveEmailChannelConfig();
  const cfg = await ctx.emailConfig;
  if (!cfg.enabled) {
    for (const d of rows) result.set(d.id, { status: "failed", error: clip(`Kanal kapalı: ${cfg.reason ?? "e-posta yapılandırılmadı"}`) });
    return result;
  }
  // Adresler parti başına TEK sorguda.
  const userIds = [...new Set(rows.map((d) => d.user_id))];
  const { data: emails, error: emailErr } = await admin.rpc("platform_announcement_recipient_emails", { p_users: userIds });
  if (emailErr) {
    for (const d of rows) result.set(d.id, { status: "retry", error: "Alıcı adresleri okunamadı", backoffMs: RETRY_BACKOFF_MS });
    return result;
  }
  const emailOf = new Map(((emails ?? []) as { user_id: string; email: string | null }[]).map((r) => [r.user_id, r.email]));
  const base = getBaseUrl();
  const sendable: { d: DeliveryRow; item: { to: string; subject: string; text: string } }[] = [];
  for (const d of rows) {
    const email = emailOf.get(d.user_id);
    if (!email) {
      result.set(d.id, { status: "skipped", error: "Kullanıcının e-posta adresi yok" });
      continue;
    }
    const a = ann.get(d.announcement_id)!;
    const link = a.href ? `\n\nAyrıntı: ${base}${trackingPath(d.id)}` : "";
    const footer = a.commercial ? "\n\nBu ileti, bildirim tercihlerinizde pazarlama iletilerine izin verdiğiniz için gönderildi. Tercihinizi Hesabım > Bildirimler'den değiştirebilirsiniz." : "";
    sendable.push({ d, item: { to: email, subject: a.title, text: `${a.body ?? a.title}${link}${footer}` } });
  }
  let rateLimited = false;
  for (let i = 0; i < sendable.length; i += EMAIL_BATCH_MAX) {
    const chunk = sendable.slice(i, i + EMAIL_BATCH_MAX);
    if (!rateLimited && now() < ctx.deadline) await emailThrottle(ctx);
    if (rateLimited || now() >= ctx.deadline) {
      // Denenmedi: bütçe bitti ya da sağlayıcı bu partide hız sınırı dedi (aynı sınıra tekrar çarpılmaz).
      for (const { d } of chunk) result.set(d.id, rateLimited ? { status: "deferred", error: null, backoffMs: RETRY_BACKOFF_MS } : DEFERRED_BUDGET);
      continue;
    }
    const res = await sendEmailBatch(cfg, chunk.map((c) => c.item));
    chunk.forEach(({ d }, k) => {
      const r = res[k];
      if (r.ok) result.set(d.id, { status: "sent", providerId: r.id });
      else if (r.retryable) {
        if (r.error === "HTTP 429") rateLimited = true;
        result.set(d.id, { status: "retry", error: clip(`Sağlayıcı geçici hatası: ${r.error}`), backoffMs: RETRY_BACKOFF_MS * d.attempts });
      } else result.set(d.id, { status: "failed", error: clip(r.code === "disabled" ? `Kanal kapalı: ${r.error}` : r.error) });
    });
  }
  return result;
}

async function deliverPush(admin: SupabaseClient, rows: DeliveryRow[], ann: Map<string, AnnouncementRow>, ctx: RunCtx): Promise<Map<string, Outcome>> {
  const result = new Map<string, Outcome>();
  if (!pushConfigured()) {
    for (const d of rows) result.set(d.id, { status: "failed", error: "Kanal kapalı: VAPID anahtarı tanımlı değil" });
    return result;
  }
  const userIds = [...new Set(rows.map((d) => d.user_id))];
  const { data: subs } = await admin.from("push_subscriptions").select("user_id").in("user_id", userIds);
  const withSub = new Set(((subs ?? []) as { user_id: string }[]).map((s) => s.user_id));
  const outcomes = await mapLimit(rows, 5, ctx.deadline, async (d): Promise<Outcome> => {
    if (!withSub.has(d.user_id)) return { status: "skipped", error: "Kayıtlı cihaz (push aboneliği) yok" };
    const a = ann.get(d.announcement_id)!;
    try {
      await sendPushToUser(d.tenant_id, d.user_id, { title: a.title, body: a.body ?? undefined, href: a.href ? trackingPath(d.id) : undefined });
      return { status: "sent" };
    } catch (e) {
      return { status: "failed", error: clip(e instanceof Error ? e.message : "Push gönderilemedi") };
    }
  }, () => DEFERRED_BUDGET);
  rows.forEach((d, i) => result.set(d.id, outcomes[i]));
  return result;
}

/** Duyuru sayaçlarını teslim durumlarından yeniden hesaplar; bekleyeni kalmadıysa kapatır. */
export async function finalizeAnnouncement(admin: SupabaseClient, id: string): Promise<boolean> {
  const count = async (statuses: string[], channel?: DeliveryChannel) => {
    let q = admin.from("platform_announcement_deliveries").select("id", { count: "exact", head: true }).eq("announcement_id", id).in("status", statuses);
    if (channel) q = q.eq("channel", channel);
    const { count: c } = await q;
    return c ?? 0;
  };
  const [open, sent, failed, skipped, expired, inApp, email, push] = await Promise.all([
    count(["pending", "sending"]),
    count(["sent"]),
    count(["failed"]),
    count(["skipped"]),
    count(["expired"]),
    count(["sent"], "in_app"),
    count(["sent"], "email"),
    count(["sent"], "push"),
  ]);
  const nowIso = new Date(now()).toISOString();
  const patch: Record<string, unknown> = {
    delivered_count: sent,
    failed_count: failed,
    stats: { in_app_sent: inApp, email_sent: email, push_sent: push, skipped, expired, open },
    updated_at: nowIso,
  };
  const done = open === 0;
  if (done) {
    patch.finished_at = nowIso;
    patch.status = failed > 0 ? "partial" : sent === 0 && expired > 0 ? "expired" : "sent";
  }
  await admin.from("platform_announcements").update(patch).eq("id", id).in("status", ["sending", "sent", "partial"]);
  return done;
}

/**
 * Kuyruğu işler. `announcementId` verilirse yalnız o duyuru (gönderim anındaki after()); verilmezse tümü (cron).
 * Hiçbir zaman fırlatmaz: hata özetin içinde döner (cron adımı ana işi bozmaz).
 */
export async function processAnnouncementQueue(
  admin: SupabaseClient,
  opts: { budgetMs: number; batchSize?: number; announcementId?: string; emailRatePerSec?: number; sleep?: (ms: number) => Promise<void> },
): Promise<QueueSummary> {
  const started = now();
  const ctx: RunCtx = { deadline: started + opts.budgetMs, emailRatePerSec: opts.emailRatePerSec ?? 2, sleep: opts.sleep ?? realSleep };
  const summary: QueueSummary = { materialized: 0, delivered: 0, failed: 0, skipped: 0, finished: 0, budgetHit: false };
  const batch = Math.max(10, Math.min(opts.batchSize ?? 200, 1000));
  const touched = new Set<string>();

  const due = await claimDueAnnouncements(admin, opts.announcementId);
  if (due.schemaMissing) return { ...summary, schemaMissing: true };
  summary.materialized = due.count;

  while (now() - started < opts.budgetMs) {
    const { data, error } = await admin.rpc("platform_announcement_claim", { p_limit: batch, p_announcement: opts.announcementId ?? null });
    if (error) {
      if (isSchemaMissing(error)) return { ...summary, schemaMissing: true };
      throw new Error(`Teslim kuyruğu okunamadı: ${error.message}`);
    }
    const rows = (data ?? []) as DeliveryRow[];
    if (rows.length === 0) break;

    const annIds = [...new Set(rows.map((r) => r.announcement_id))];
    const { data: anns } = await admin.from("platform_announcements").select(ANN_COLS).in("id", annIds);
    const ann = new Map(((anns ?? []) as AnnouncementRow[]).map((a) => [a.id, a]));

    const outcomes = new Map<string, Outcome>();
    const live: DeliveryRow[] = [];
    for (const d of rows) {
      touched.add(d.announcement_id);
      const a = ann.get(d.announcement_id);
      if (!a || a.status === "cancelled") outcomes.set(d.id, { status: "expired", error: "Duyuru iptal edildi" });
      else if (a.expires_at && new Date(a.expires_at).getTime() <= now()) outcomes.set(d.id, { status: "expired", error: "Bitiş tarihi geçti" });
      else live.push(d);
    }
    const byChannel = (c: DeliveryChannel) => live.filter((d) => d.channel === c);
    const parts = await Promise.all([
      byChannel("in_app").length ? deliverInApp(admin, byChannel("in_app"), ann) : new Map<string, Outcome>(),
      byChannel("email").length ? deliverEmail(admin, byChannel("email"), ann, ctx) : new Map<string, Outcome>(),
      byChannel("push").length ? deliverPush(admin, byChannel("push"), ann, ctx) : new Map<string, Outcome>(),
    ]);
    for (const m of parts) for (const [k, v] of m) outcomes.set(k, v);

    const nowIso = new Date(now()).toISOString();
    let waiting = 0;
    const updates = rows.map((d) => {
      let o: Outcome = outcomes.get(d.id) ?? { status: "failed", error: "Sonuç alınamadı" };
      if (o.status === "retry" && d.attempts >= MAX_ATTEMPTS) o = { status: "failed", error: clip(`${o.error ?? "Geçici hata"} (${MAX_ATTEMPTS} deneme)`) };
      const again = o.status === "retry" || o.status === "deferred";
      if (o.status === "sent") summary.delivered++;
      else if (o.status === "failed") summary.failed++;
      else if (again) waiting++;
      else summary.skipped++;
      return {
        id: d.id,
        announcement_id: d.announcement_id,
        tenant_id: d.tenant_id,
        user_id: d.user_id,
        channel: d.channel,
        // Denenmeyen (ertelenen) satırın sahiplenmede artan denemesi geri alınır.
        attempts: o.status === "deferred" ? Math.max(0, d.attempts - 1) : d.attempts,
        status: again ? "pending" : o.status,
        error: o.error ?? null,
        not_before: again && o.backoffMs ? new Date(now() + o.backoffMs).toISOString() : null,
        notification_id: o.notificationId ?? d.notification_id,
        provider_id: o.providerId ?? d.provider_id,
        sent_at: o.status === "sent" ? nowIso : d.sent_at,
        locked_at: null,
        updated_at: nowIso,
      };
    });
    const { error: upErr } = await admin.from("platform_announcement_deliveries").upsert(updates, { onConflict: "id" });
    if (upErr) throw new Error(`Teslim sonuçları yazılamadı: ${upErr.message}`);
    summary.retrying = (summary.retrying ?? 0) + waiting;
    if (rows.length < batch || now() >= ctx.deadline) break;
  }
  if (now() - started >= opts.budgetMs) summary.budgetHit = true;

  // Bu çalıştırmada dokunulan + teslim satırı hiç olmayan (boş segment) duyurular kapanır.
  if (opts.announcementId) touched.add(opts.announcementId);
  const { data: openAnns } = await admin.from("platform_announcements").select("id").eq("status", "sending").not("materialized_at", "is", null).limit(20);
  for (const r of (openAnns ?? []) as { id: string }[]) touched.add(r.id);
  for (const id of touched) if (await finalizeAnnouncement(admin, id)) summary.finished++;
  return summary;
}
