import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTenant } from "@/lib/notify";
import { readTenantSettings, numberSetting } from "@/lib/settings/tenant-read";
import { EIDS_ACTION_SETTING_KEYS } from "@/lib/settings/registry/eids-actions";
import { enqueueTakedownChecks } from "@/lib/listing-control/server/queue";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { DAY_MS, trDayKey, trParts } from "@/lib/clock";
import { getDisabledModulesByTenant, isDisabledFor } from "@/lib/modules/state";
import {
  EIDS_MATCH_QUEUE_STATUSES,
  PUBLISH_DUE_BUSINESS_DAYS,
  TAKEDOWN_DUE_DAYS,
  TAKEDOWN_ESCALATE_HOURS,
  EIDS_ACTIONABLE_EVENT_KINDS,
  addBusinessDaysMs,
  decideForEvent,
  isAuthorityEndPast,
  planTakedownItems,
  propertyLabel,
  publishDedupeKey,
  publishTaskText,
  shouldEscalate,
  takedownDedupeKey,
  takedownTaskText,
  trIsoWeekKey,
  type AuthorityEventInput,
  type PlannedItem,
  type TakedownCause,
} from "./actions-core";

/**
 * EİDS AKSİYON MOTORU (sunucu): yetki olayından görev/bildirim üretimi. İDEMPOTENT: her görev `tasks.dedupe_key`, her
 * bildirim `notifications.dedupe_key` taşır; aynı olay ikinci kez işlenirse yeni görev ya da bildirim açılmaz.
 *
 * İstemci (service_role) ÇAĞIRAN tarafından verilir (cron: gorev-hatirlat; e-posta alımı: EP3 inbound yolu). Bu dosya
 * `createAdminClient` ÇAĞIRMAZ. Yetki durumunu YAZMAZ: tek yazma noktası EP2'nin `applyAuthorityEvent()` defteridir; burada
 * yalnız görev, kontrol listesi, bildirim ve EmlakSoft'un kendi yüzeyleri (vitrin, paylaşım bağlantısı) değişir.
 *
 * ANLIK AKIŞ: `applyAuthorityEvent` / `undoAuthorityEvent` başarılı döndüğünde çağıran `scheduleAuthorityEventActions`
 * (`./actions-dispatch`) ile aynı istekte, yanıttan hemen sonra (`after()`) `runAuthorityEventById` çalışır: görev ve
 * bildirim saniyeler içinde açılır. Cron (`runEidsActionSweep`) son 3 günün olaylarını yeniden tarar (yedek): kaçan olay
 * en geç bir sonraki turda işlenir; tekil anahtarlar sayesinde anlık akışta açılmış görev ikinci kez açılmaz.
 */

type Db = SupabaseClient;
type PropertyRow = {
  id: string;
  tenant_id: string;
  title: string | null;
  property_code: string | null;
  assigned_to: string | null;
  branch_id: string | null;
  status: string | null;
  authorization_end: string | null;
  authority_eids_status: string | null;
};

const PROPERTY_COLUMNS = "id, tenant_id, title, property_code, assigned_to, branch_id, status, authorization_end, authority_eids_status";
const MANAGEMENT_ROLES = ["owner", "gm", "branch_manager"] as const;

export type ActionOutcome = { status: "created" | "exists" | "skipped" | "schema_missing" | "error"; taskId?: string; detail?: string };

async function loadProperty(db: Db, tenantId: string, propertyId: string): Promise<PropertyRow | null> {
  const { data } = await db
    .from("properties")
    .select(PROPERTY_COLUMNS)
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .eq("is_sample", false)
    .maybeSingle();
  return (data as PropertyRow | null) ?? null;
}

/**
 * Ofisin AKTİF üyeliği olan portallar (EP1 `tenant_portal_accounts.status='active'`; `getActivePortals` ile aynı kaynak).
 * Tablo henüz yoksa `null`: üyelik bilinmiyor, kontrol listesi tüm canlı kayıtları içerir (güvenli taraf).
 */
export async function loadActivePortalKeys(db: Db, tenantId: string): Promise<Set<string> | null> {
  const { data, error } = await db.from("tenant_portal_accounts").select("portal, status").eq("tenant_id", tenantId);
  if (error) return null;
  return new Set(((data ?? []) as { portal: string; status: string }[]).filter((r) => r.status === "active").map((r) => r.portal.trim().toLowerCase()));
}

/** Ofisin aktif yönetim alıcıları: owner + gm (+ portföyün şubesindeki şube müdürü). */
async function managementRecipients(db: Db, tenantId: string, branchId: string | null, roles: readonly string[] = MANAGEMENT_ROLES): Promise<string[]> {
  const { data } = await db
    .from("profiles")
    .select("id, role, branch_id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("role", roles as string[]);
  return ((data ?? []) as { id: string; role: string; branch_id: string | null }[])
    .filter((p) => p.role !== "branch_manager" || (branchId !== null && p.branch_id === branchId))
    .map((p) => p.id);
}

/** Tek bildirim (zil + push). Tekil anahtar sayesinde tekrar yazılmaz; hedef pasifse sessizce atlanır. */
async function notifyOnce(input: Parameters<typeof notifyTenant>[0]): Promise<boolean> {
  try {
    await notifyTenant(input);
    return true;
  } catch (e) {
    console.error("eids notify", e instanceof Error ? e.message : "hata");
    return false;
  }
}

async function readActionSettings(db: Db, tenantId: string) {
  const v = await readTenantSettings(db, tenantId, [EIDS_ACTION_SETTING_KEYS.autoHidePublic, EIDS_ACTION_SETTING_KEYS.escalationHours]);
  return {
    autoHidePublic: v[EIDS_ACTION_SETTING_KEYS.autoHidePublic] !== false,
    escalationHours: numberSetting(v, EIDS_ACTION_SETTING_KEYS.escalationHours, TAKEDOWN_ESCALATE_HOURS),
  };
}

/* ------------------------------------------------------------------ */
/* EmlakSoft yüzeyleri: kapat / geri aç                               */
/* ------------------------------------------------------------------ */

type ItemRow = PlannedItem & { status: "pending" | "removed" | "not_found"; verified_by: "system" | null; restore_meta: Record<string, unknown> | null; done_at: string | null };

/**
 * Vitrin ve paylaşım bağlantılarını kapatır (geri alınabilir). Vitrin = portföyün yayında (`live`) durumu: `draft`'a alınır,
 * önceki durum kaleme yazılır. Paylaşım = süresi dolmamış `share_links`: bitişi şimdiye çekilir, eski bitişler kaleme yazılır.
 */
async function hideOwnSurfaces(db: Db, p: PropertyRow, nowIso: string): Promise<{ vitrin: ItemRow; paylasim: ItemRow }> {
  let vitrin: ItemRow;
  if (p.status === "live") {
    const { data, error } = await db
      .from("properties")
      .update({ status: "draft" })
      .eq("id", p.id)
      .eq("tenant_id", p.tenant_id)
      .eq("status", "live")
      .select("id");
    vitrin =
      !error && (data ?? []).length > 0
        ? { target: "vitrin", portal_listing_id: null, status: "removed", verified_by: "system", restore_meta: { prev_status: "live" }, done_at: nowIso }
        : { target: "vitrin", portal_listing_id: null, status: "pending", verified_by: null, restore_meta: null, done_at: null };
  } else {
    vitrin = { target: "vitrin", portal_listing_id: null, status: "not_found", verified_by: "system", restore_meta: null, done_at: nowIso };
  }

  const { data: links, error: lErr } = await db
    .from("share_links")
    .select("id, expires_at")
    .eq("tenant_id", p.tenant_id)
    .eq("entity_type", "property")
    .eq("entity_id", p.id)
    .gt("expires_at", nowIso)
    .limit(200);
  let paylasim: ItemRow;
  const rows = (links ?? []) as { id: string; expires_at: string }[];
  if (lErr) {
    paylasim = { target: "paylasim", portal_listing_id: null, status: "pending", verified_by: null, restore_meta: null, done_at: null };
  } else if (rows.length === 0) {
    paylasim = { target: "paylasim", portal_listing_id: null, status: "not_found", verified_by: "system", restore_meta: null, done_at: nowIso };
  } else {
    const { error: uErr } = await db
      .from("share_links")
      .update({ expires_at: nowIso })
      .eq("tenant_id", p.tenant_id)
      .in("id", rows.map((r) => r.id));
    paylasim = uErr
      ? { target: "paylasim", portal_listing_id: null, status: "pending", verified_by: null, restore_meta: null, done_at: null }
      : { target: "paylasim", portal_listing_id: null, status: "removed", verified_by: "system", restore_meta: { links: rows }, done_at: nowIso };
  }
  return { vitrin, paylasim };
}

/**
 * Otomatik kapatılan yüzeyleri geri açar (yetki geri geldiğinde ya da yönetici "geri al" dediğinde). Vitrin yalnız hâlâ
 * `draft` ise eski durumuna döner (arada elle değiştirildiyse dokunulmaz); paylaşım bağlantıları eski bitişlerine döner.
 * İstemci: cron/inbound için service_role, ekrandan çağrıda kullanıcı oturumu (RLS).
 */
export async function restoreOwnSurfaces(db: Db, tenantId: string, taskId: string): Promise<{ restored: number }> {
  const { data } = await db
    .from("eids_takedown_items")
    .select("id, target, property_id, restore_meta, verified_by")
    .eq("tenant_id", tenantId)
    .eq("task_id", taskId)
    .eq("verified_by", "system")
    .in("target", ["vitrin", "paylasim"]);
  let restored = 0;
  for (const it of (data ?? []) as { id: string; target: string; property_id: string | null; restore_meta: Record<string, unknown> | null }[]) {
    const meta = it.restore_meta ?? {};
    if (it.target === "vitrin" && it.property_id && typeof meta.prev_status === "string") {
      const { data: up } = await db
        .from("properties")
        .update({ status: meta.prev_status })
        .eq("id", it.property_id)
        .eq("tenant_id", tenantId)
        .eq("status", "draft")
        .select("id");
      if ((up ?? []).length > 0) restored += 1;
    }
    if (it.target === "paylasim" && Array.isArray(meta.links)) {
      for (const l of meta.links as { id?: string; expires_at?: string }[]) {
        if (!l.id || !l.expires_at) continue;
        const { error } = await db.from("share_links").update({ expires_at: l.expires_at }).eq("id", l.id).eq("tenant_id", tenantId);
        if (!error) restored += 1;
      }
    }
  }
  return { restored };
}

/** Kalemler yazılamadan geri alınan görevde otomatik kapatılan yüzeyleri (kalem kaydı olmadan) eski haline döndürür. */
async function restoreFromPlan(db: Db, p: PropertyRow, own: { vitrin: ItemRow; paylasim: ItemRow } | null): Promise<void> {
  if (!own) return;
  if (own.vitrin.verified_by === "system" && typeof own.vitrin.restore_meta?.prev_status === "string") {
    await db.from("properties").update({ status: own.vitrin.restore_meta.prev_status }).eq("id", p.id).eq("tenant_id", p.tenant_id).eq("status", "draft");
  }
  const links = own.paylasim.restore_meta?.links;
  if (own.paylasim.verified_by === "system" && Array.isArray(links)) {
    for (const l of links as { id?: string; expires_at?: string }[]) {
      if (l.id && l.expires_at) await db.from("share_links").update({ expires_at: l.expires_at }).eq("id", l.id).eq("tenant_id", p.tenant_id);
    }
  }
}

/**
 * Kaldırma yükümlülüğü hâlâ sürüyor mu? Portföyün GÜNCEL yetki durumu iptal/süresi dolmuş ya da bitiş tarihi geçmişse
 * evet: o zaman hiçbir geri alma/verme olayı (özellikle cron'un yeniden oynattığı eski olay) açık görevi iptal etmez.
 */
function takedownStillRequired(p: PropertyRow, nowMs: number): boolean {
  return (p.authority_eids_status !== null && REVOKED_STATUSES.has(p.authority_eids_status)) || isAuthorityEndPast(p.authorization_end, nowMs);
}
const REVOKED_STATUSES = new Set(["revoked", "expired"]);

/** Olay anı (ISO): defter satırının created_at'i; yoksa (doğrudan çağrı) şimdi. */
const eventAtIso = (ev: AuthorityEventInput, nowMs: number): string => (ev.created_at && Number.isFinite(Date.parse(ev.created_at)) ? ev.created_at : new Date(nowMs).toISOString());

/* ------------------------------------------------------------------ */
/* Kaldırma görevi                                                    */
/* ------------------------------------------------------------------ */

/**
 * ACİL kaldırma görevi (kind=eids_takedown, priority=urgent, due=+3 gün) + kontrol listesi + yüzey kapatma + öncelikli
 * kontrol işi + bildirimler. Aynı portföyde açık kaldırma görevi varsa yenisi açılmaz; aynı neden (dedupe_key) ikinci kez
 * gelirse hiçbir şey yazılmaz.
 */
export async function openTakedownTask(db: Db, input: { tenantId: string; propertyId: string; cause: TakedownCause; nowMs: number }): Promise<ActionOutcome> {
  const p = await loadProperty(db, input.tenantId, input.propertyId);
  if (!p) return { status: "skipped", detail: "portfoy_yok" };

  const { data: open, error: openErr } = await db
    .from("tasks")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("property_id", p.id)
    .eq("kind", "eids_takedown")
    .eq("status", "open")
    .limit(1);
  if (openErr) return { status: isMissingSchema(openErr) ? "schema_missing" : "error", detail: openErr.code ?? undefined };
  if ((open ?? []).length > 0) return { status: "exists", taskId: (open as { id: string }[])[0].id };

  const label = propertyLabel(p);
  const text = takedownTaskText({ label, cause: input.cause });
  const dedupeKey = takedownDedupeKey(p.id, input.cause);
  // Danışman yoksa görev ofis sahibine düşer (sahipsiz acil görev olmaz).
  const assignee = p.assigned_to ?? (await managementRecipients(db, input.tenantId, null, ["owner"]))[0] ?? null;
  const { data: created, error } = await db
    .from("tasks")
    .insert({
      tenant_id: input.tenantId,
      title: text.title,
      notes: text.notes,
      kind: "eids_takedown",
      priority: "urgent",
      status: "open",
      due_at: new Date(input.nowMs + TAKEDOWN_DUE_DAYS * DAY_MS).toISOString(),
      assigned_to: assignee,
      property_id: p.id,
      dedupe_key: dedupeKey,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { status: "exists", detail: "dedupe" };
    return { status: isMissingSchema(error) || error.code === "23514" ? "schema_missing" : "error", detail: error.code ?? undefined };
  }
  const taskId = (created as { id: string }).id;
  const nowIso = new Date(input.nowMs).toISOString();

  // Kontrol listesi: aktif üyelikli portallardaki canlı kayıtlar + vitrin + paylaşım + sosyal.
  const [{ data: live }, activePortals, settings] = await Promise.all([
    db.from("portal_listings").select("id, portal_name").eq("tenant_id", input.tenantId).eq("property_id", p.id).eq("status", "live"),
    loadActivePortalKeys(db, input.tenantId),
    readActionSettings(db, input.tenantId),
  ]);
  const planned = planTakedownItems({ liveListings: (live ?? []) as { id: string; portal_name: string | null }[], activePortals });
  const own = settings.autoHidePublic ? await hideOwnSurfaces(db, p, nowIso) : null;
  const rows = planned.map((it) => {
    const auto = own && (it.target === "vitrin" || it.target === "paylasim") ? own[it.target as "vitrin" | "paylasim"] : null;
    return {
      tenant_id: input.tenantId,
      task_id: taskId,
      property_id: p.id,
      target: it.target,
      portal_listing_id: it.portal_listing_id,
      status: auto?.status ?? "pending",
      verified_by: auto?.verified_by ?? null,
      restore_meta: auto?.restore_meta ?? null,
      done_at: auto?.done_at ?? null,
    };
  });
  const { error: itemErr } = await db.from("eids_takedown_items").insert(rows);
  if (itemErr) {
    // Kalemsiz görev hiç kapanamaz (canCloseTakedown) ve dedupe yüzünden yeniden kurulmaz: görev geri alınır, yüzeyler
    // geri açılır; sonraki tur (cron) baştan dener.
    console.error("eids takedown items", { code: itemErr.code });
    await restoreFromPlan(db, p, own);
    await db.from("tasks").delete().eq("id", taskId).eq("tenant_id", input.tenantId);
    return { status: isMissingSchema(itemErr) ? "schema_missing" : "error", detail: itemErr.code ?? "kalem_yazilamadi" };
  }

  // Eklentili ofiste öncelikli kontrol işi: "kalktı" sonucu kalemi kendiliğinden işaretler (DB tetiği).
  const portalIds = planned.map((i) => i.portal_listing_id).filter((v): v is string => Boolean(v));
  const queue = portalIds.length > 0 ? await enqueueTakedownChecks(db, input.tenantId, portalIds, input.nowMs) : { hasClient: false, enqueued: 0, schemaMissing: false };

  // Bildirimler: danışman + owner/gm/şube müdürü, anında (zil + push). Tercih kapısı YOK: yasal zorunluluk.
  const href = `/app/gorevler/eids/${taskId}`;
  const why = input.cause.kind === "expire" ? "yetki süresi doldu" : "malik yetkiyi iptal etti";
  const body = `${label}: ${why}. 3 gün içinde portallardan kaldırın.${queue.hasClient ? " Eklenti kaldırmayı doğrulayacak." : ""}`;
  const recipients = new Set<string>([...(assignee ? [assignee] : []), ...(await managementRecipients(db, input.tenantId, p.branch_id))]);
  for (const userId of recipients) {
    await notifyOnce({
      tenantId: input.tenantId,
      userId,
      title: userId === assignee ? "ACİL: ilanı 3 gün içinde kaldırın" : "EİDS yetkisi sona erdi: kaldırma görevi açıldı",
      body,
      href,
      kind: "danger",
      dedupeKey: `eids:takedown:${taskId}:${userId}`,
    });
  }
  return { status: "created", taskId };
}

/**
 * Yetki geri geldi (geri alma / elle düzeltme / bağlama): açık kaldırma görevi iptal edilir, otomatik kapatılan yüzeyler
 * açılır. YENİDEN OYNATMA GÜVENLİ: yalnız olaydan ÖNCE açılmış görevler kapanır ve portföy hâlâ iptal/süresi dolmuş
 * durumdaysa (ör. geri almadan sonra yeni bir iptal geldi) hiçbir şey iptal edilmez.
 */
export async function cancelOpenTakedown(db: Db, tenantId: string, propertyId: string, opts: { beforeIso: string; nowMs: number }): Promise<number> {
  const p = await loadProperty(db, tenantId, propertyId);
  if (!p || takedownStillRequired(p, opts.nowMs)) return 0;
  const { data } = await db
    .from("tasks")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .eq("kind", "eids_takedown")
    .eq("status", "open")
    .lt("created_at", opts.beforeIso);
  let n = 0;
  for (const t of (data ?? []) as { id: string }[]) {
    await restoreOwnSurfaces(db, tenantId, t.id);
    const { error } = await db.from("tasks").update({ status: "cancelled" }).eq("id", t.id).eq("tenant_id", tenantId).eq("status", "open");
    if (!error) n += 1;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Verme / uzatma                                                     */
/* ------------------------------------------------------------------ */

async function hasLivePortalListing(db: Db, tenantId: string, propertyId: string): Promise<boolean> {
  const { data } = await db.from("portal_listings").select("id").eq("tenant_id", tenantId).eq("property_id", propertyId).eq("status", "live").limit(1);
  return (data ?? []).length > 0;
}

/**
 * Yetki geldi: ilan canlı değilse danışmana "İlanı hazırla/yayınla" görevi (2 iş günü), canlıysa yalnız bilgi notu.
 * Bitiş hatırlatmaları (30/15/7/3 gün) mevcut `deadline@1` / `authority_renewal@1` kurallarından gelir.
 */
async function onGrant(db: Db, ev: AuthorityEventInput, nowMs: number): Promise<ActionOutcome> {
  const p = await loadProperty(db, ev.tenant_id, String(ev.property_id));
  if (!p) return { status: "skipped", detail: "portfoy_yok" };
  // Daha ileri tarihli yeni yetki: süre bitimiyle açılmış kaldırma görevi artık gereksiz.
  await cancelExpireTakedowns(db, ev.tenant_id, p.id, { beforeIso: eventAtIso(ev, nowMs), nowMs });
  const label = propertyLabel(p);
  const live = p.status === "live" || (await hasLivePortalListing(db, ev.tenant_id, p.id));
  const assignee = p.assigned_to;
  if (live) {
    if (assignee) {
      await notifyOnce({
        tenantId: ev.tenant_id,
        userId: assignee,
        title: "EİDS yetkisi geldi",
        body: `${label}: malik e-Devlet'te yetki verdi; ilan yayında, ek işlem gerekmez.`,
        href: `/app/portfoyler/${p.id}`,
        kind: "success",
        prefKey: "authority",
        dedupeKey: `eids:grant:${ev.id}`,
      });
    }
    return { status: "skipped", detail: "canli_bilgi_notu" };
  }
  const text = publishTaskText({ label, validUntil: ev.valid_until });
  const { data, error } = await db
    .from("tasks")
    .insert({
      tenant_id: ev.tenant_id,
      title: text.title,
      notes: text.notes,
      kind: "eids_publish",
      priority: "high",
      status: "open",
      due_at: new Date(addBusinessDaysMs(nowMs, PUBLISH_DUE_BUSINESS_DAYS)).toISOString(),
      assigned_to: assignee,
      property_id: p.id,
      dedupe_key: publishDedupeKey(p.id, ev.valid_until, ev.id),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { status: "exists", detail: "dedupe" };
    return { status: isMissingSchema(error) || error.code === "23514" ? "schema_missing" : "error", detail: error.code ?? undefined };
  }
  const taskId = (data as { id: string }).id;
  if (assignee) {
    await notifyOnce({
      tenantId: ev.tenant_id,
      userId: assignee,
      title: "EİDS yetkisi geldi: ilanı hazırlayın",
      body: `${label}: 2 iş günü içinde ilanı hazırlayıp yayınlayın.`,
      href: "/app/gorevler?tur=eids_publish",
      kind: "info",
      prefKey: "authority",
      dedupeKey: `eids:publish:${taskId}`,
    });
  }
  return { status: "created", taskId };
}

/** Otomasyon (`[oto:…]`) ya da içgörüden kabul edilen (`[ins:…]`) görevin notundaki iz. Elle açılan görev bunu taşımaz. */
const GENERATED_TASK_MARKER = /\[(?:oto|ins):[0-9a-f]/i;

/**
 * Yenileme/hatırlatma görevleri: portföye bağlı, açık, başlığında "yetki" geçen ve YALNIZ otomasyon/içgörüden gelen
 * (elle açılan "Yetki belgesi imzalat" gibi görevlere dokunulmaz). Yeniden oynatmada uzatmadan SONRA açılan görev kapanmaz.
 */
async function closeRenewalTasks(db: Db, tenantId: string, propertyId: string, nowMs: number, beforeIso: string): Promise<number> {
  const { data } = await db
    .from("tasks")
    .select("id, notes")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .eq("status", "open")
    .not("kind", "in", "(eids_publish,eids_takedown)")
    .ilike("title", "%yetki%")
    .lt("created_at", beforeIso)
    .limit(50);
  const ids = ((data ?? []) as { id: string; notes: string | null }[]).filter((t) => GENERATED_TASK_MARKER.test(t.notes ?? "")).map((t) => t.id);
  if (ids.length === 0) return 0;
  const { error } = await db
    .from("tasks")
    .update({ status: "done", completed_at: new Date(nowMs).toISOString() })
    .eq("tenant_id", tenantId)
    .in("id", ids)
    .eq("status", "open");
  return error ? 0 : ids.length;
}

/**
 * Süre bitimiyle açılmış (iptalle değil) açık kaldırma görevleri: uzatma/yeni yetki gelince iptal edilir. Yeniden oynatma
 * güvenli: yalnız olaydan önce açılmış görevler ve yalnız portföyün güncel yetkisi geçerliyse (bitiş geçmemiş, iptal yok).
 */
async function cancelExpireTakedowns(db: Db, tenantId: string, propertyId: string, opts: { beforeIso: string; nowMs: number }): Promise<number> {
  const p = await loadProperty(db, tenantId, propertyId);
  if (!p || takedownStillRequired(p, opts.nowMs)) return 0;
  const { data } = await db
    .from("tasks")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .eq("kind", "eids_takedown")
    .eq("status", "open")
    .like("dedupe_key", `eids:takedown:${propertyId}:expire:%`)
    .lt("created_at", opts.beforeIso);
  let n = 0;
  for (const t of (data ?? []) as { id: string }[]) {
    await restoreOwnSurfaces(db, tenantId, t.id);
    const { error } = await db.from("tasks").update({ status: "cancelled" }).eq("id", t.id).eq("tenant_id", tenantId).eq("status", "open");
    if (!error) n += 1;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Tek giriş                                                          */
/* ------------------------------------------------------------------ */

/**
 * Defter olayına karşılık gelen aksiyon (idempotent). EP2/EP3 `applyAuthorityEvent` sonrasında çağırır; cron da yeniden
 * tarar. Eşleşmemiş (property_id yok) olay burada işlenmez: eşleştir kuyruğu bildirimini `runEidsActionSweep` verir.
 */
export async function onAuthorityEvent(db: Db, ev: AuthorityEventInput, nowMs: number): Promise<ActionOutcome> {
  const d = decideForEvent(ev);
  switch (d.action) {
    case "publish_or_note":
      return onGrant(db, ev, nowMs);
    case "extend": {
      const pid = String(ev.property_id);
      const beforeIso = eventAtIso(ev, nowMs);
      const closed = await closeRenewalTasks(db, ev.tenant_id, pid, nowMs, beforeIso);
      const cancelled = await cancelExpireTakedowns(db, ev.tenant_id, pid, { beforeIso, nowMs });
      return { status: "skipped", detail: `uzatma: ${closed} yenileme gorevi kapandi, ${cancelled} kaldirma iptal` };
    }
    case "takedown":
      return openTakedownTask(db, { tenantId: ev.tenant_id, propertyId: String(ev.property_id), cause: d.cause, nowMs });
    case "undo_takedown": {
      const n = await cancelOpenTakedown(db, ev.tenant_id, String(ev.property_id), { beforeIso: eventAtIso(ev, nowMs), nowMs });
      return { status: "skipped", detail: `geri alma: ${n} kaldirma iptal` };
    }
    case "none":
      return { status: "skipped", detail: d.reason };
  }
}

/** Aksiyon motorunun okuduğu defter sütunları (anlık akış ve cron aynı biçimi okur). */
const EVENT_COLUMNS = "id, tenant_id, property_id, kind, source, valid_until, prev_status, new_status, created_at";

/**
 * Anlık akış: deftere yeni yazılmış olayı kimliğiyle (kiracı süzgeciyle) okuyup `onAuthorityEvent` çalıştırır. Eyleme
 * dönüşmeyen tür ya da eşleşmemiş olay atlanır. Cron aynı olayı yeniden işlese de tekil anahtarlar tekrarı önler.
 */
export async function runAuthorityEventById(db: Db, tenantId: string, eventId: string, nowMs: number): Promise<ActionOutcome> {
  if (!tenantId || !eventId) return { status: "skipped", detail: "kimlik_yok" };
  const { data, error } = await db.from("eids_authority_events").select(EVENT_COLUMNS).eq("tenant_id", tenantId).eq("id", eventId).maybeSingle();
  if (error) return { status: isMissingSchema(error) ? "schema_missing" : "error", detail: error.code ?? undefined };
  const ev = data as AuthorityEventInput | null;
  if (!ev) return { status: "skipped", detail: "olay_yok" };
  if (!ev.property_id || !(EIDS_ACTIONABLE_EVENT_KINDS as readonly string[]).includes(ev.kind)) return { status: "skipped", detail: "eylemsiz" };
  return onAuthorityEvent(db, ev, nowMs);
}

/* ------------------------------------------------------------------ */
/* Cron adımı (gorev-hatirlat)                                        */
/* ------------------------------------------------------------------ */

export type EidsSweepSummary = {
  events: number;
  created: number;
  expired: number;
  escalated: number;
  unmatchedNotified: number;
  weeklyNotified: number;
  schemaMissing: string[];
  errors: number;
};

const EVENT_LOOKBACK_DAYS = 3;
const EXPIRE_SCAN_LIMIT = 500;
/**
 * Süre bitimi taraması yalnız YAKIN geçmişte biten yetkilere bakar: son 14 gün ve özelliğin devreye girdiği günden
 * (2026-10-14) sonra. Daha eski birikim (göç öncesi bitmiş, hâlâ yayında portföyler) otomatik gizlemeye düşmez;
 * onlar haftalık "Yetki doğrula" özeti ve pano kartıyla görünür, gerekirse ayrı ve kontrollü geri doldurma yapılır.
 */
const EXPIRE_LOOKBACK_DAYS = 14;
const EXPIRE_SCAN_FROM = "2026-10-14";

/**
 * Cron adımı (2 saatte bir, `gorev-hatirlat` içinde AYRIK adım; yeni cron yok):
 *  1. Son 3 günün defter olayları → `onAuthorityEvent` (anlık akışın yedeği: kaçan olay güvencesi; tekil anahtarlar
 *     tekrarı önler).
 *  2. `authorization_end` son 14 günde geçmiş ve yayında bir şeyi olan portföy → süre bitimi kaldırma görevi (e-posta
 *     beklenmez; portallar modülü kapalı ofis atlanır).
 *  3. 48 saatte (ayar) kapanmayan kaldırma görevi → ofis sahibine yükseltme (bir kez; `tasks.escalated_at`).
 *  4. Eşleşmeyen Bakanlık e-postası → owner + gm'e günde tek bildirim (iptal e-postası varsa ACİL).
 *  5. Pazartesi: danışmana haftalık "Yetki doğrula" özeti (hafta başına tek).
 */
export async function runEidsActionSweep(db: Db, nowMs: number): Promise<EidsSweepSummary> {
  const s: EidsSweepSummary = { events: 0, created: 0, expired: 0, escalated: 0, unmatchedNotified: 0, weeklyNotified: 0, schemaMissing: [], errors: 0 };

  // 1. Olaylar (EP2 defteri). Tablo yoksa adım atlanır.
  const since = new Date(nowMs - EVENT_LOOKBACK_DAYS * DAY_MS).toISOString();
  const { data: events, error: evErr } = await db
    .from("eids_authority_events")
    .select(EVENT_COLUMNS)
    .gte("created_at", since)
    .in("kind", [...EIDS_ACTIONABLE_EVENT_KINDS])
    .not("property_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (evErr) {
    if (isMissingSchema(evErr)) s.schemaMissing.push("eids_authority_events");
    else s.errors += 1;
  } else {
    for (const ev of (events ?? []) as AuthorityEventInput[]) {
      s.events += 1;
      try {
        const r = await onAuthorityEvent(db, ev, nowMs);
        if (r.status === "created") s.created += 1;
        if (r.status === "error") s.errors += 1;
      } catch (e) {
        console.error("eids event", e instanceof Error ? e.message : "hata");
        s.errors += 1;
      }
    }
  }

  // 2. Süre bitimi (olay beklenmez). Yalnız yakın geçmişte bitenler ve portallar modülü açık ofisler.
  const today = trDayKey(nowMs);
  const lookbackDay = trDayKey(nowMs - EXPIRE_LOOKBACK_DAYS * DAY_MS);
  const scanFrom = lookbackDay > EXPIRE_SCAN_FROM ? lookbackDay : EXPIRE_SCAN_FROM;
  const disabledModules = await getDisabledModulesByTenant(db);
  const { data: expiredRows, error: exErr } = await db
    .from("properties")
    .select("id, tenant_id, authorization_end, status")
    .lt("authorization_end", today)
    .gte("authorization_end", scanFrom)
    .is("deleted_at", null)
    .eq("is_sample", false)
    .not("status", "in", "(sold,rented,archived,withdrawn,passive,removed)")
    .order("authorization_end", { ascending: false })
    .limit(EXPIRE_SCAN_LIMIT);
  if (exErr) s.errors += 1;
  else {
    const rows = ((expiredRows ?? []) as { id: string; tenant_id: string; authorization_end: string; status: string | null }[]).filter(
      (r) => !isDisabledFor(disabledModules, r.tenant_id, "portals"),
    );
    // Yalnız yayında bir şeyi olan portföy: vitrinde (live) ya da canlı portal kaydı var.
    const notLive = rows.filter((r) => r.status !== "live").map((r) => r.id);
    const withPortal = new Set<string>();
    for (let i = 0; i < notLive.length; i += 200) {
      const { data } = await db.from("portal_listings").select("property_id").in("property_id", notLive.slice(i, i + 200)).eq("status", "live");
      for (const r of (data ?? []) as { property_id: string }[]) withPortal.add(r.property_id);
    }
    // Daha önce açılmış (kapanmış olsa da) aynı süre bitimi görevleri tek sorguda elenir (her turda yeniden denenmez).
    const keyOf = (r: { id: string; authorization_end: string }) => takedownDedupeKey(r.id, { kind: "expire", endDate: String(r.authorization_end).slice(0, 10) });
    const candidates = rows.filter((r) => r.status === "live" || withPortal.has(r.id));
    const known = new Set<string>();
    for (let i = 0; i < candidates.length; i += 200) {
      const { data, error } = await db.from("tasks").select("dedupe_key").in("dedupe_key", candidates.slice(i, i + 200).map(keyOf));
      if (error && isMissingSchema(error)) {
        s.schemaMissing.push("tasks.dedupe_key");
        candidates.length = 0;
        break;
      }
      for (const t of (data ?? []) as { dedupe_key: string }[]) known.add(t.dedupe_key);
    }
    for (const r of candidates) {
      if (known.has(keyOf(r))) continue;
      const res = await openTakedownTask(db, { tenantId: r.tenant_id, propertyId: r.id, cause: { kind: "expire", endDate: String(r.authorization_end).slice(0, 10) }, nowMs });
      if (res.status === "created") s.expired += 1;
      else if (res.status === "schema_missing") {
        s.schemaMissing.push("tasks.dedupe_key");
        break;
      } else if (res.status === "error") s.errors += 1;
    }
  }

  // 3. Yükseltme.
  const { data: openTasks, error: otErr } = await db
    .from("tasks")
    .select("id, tenant_id, title, status, created_at, escalated_at, property_id")
    .eq("kind", "eids_takedown")
    .eq("status", "open")
    .is("escalated_at", null)
    .lte("created_at", new Date(nowMs - 12 * 3_600_000).toISOString())
    .limit(500);
  if (otErr) {
    if (!isMissingSchema(otErr)) s.errors += 1;
  } else {
    const hoursByTenant = new Map<string, number>();
    for (const t of (openTasks ?? []) as { id: string; tenant_id: string; title: string; status: string; created_at: string; escalated_at: string | null }[]) {
      if (!hoursByTenant.has(t.tenant_id)) hoursByTenant.set(t.tenant_id, (await readActionSettings(db, t.tenant_id)).escalationHours);
      if (!shouldEscalate(t, nowMs, hoursByTenant.get(t.tenant_id))) continue;
      const owners = await managementRecipients(db, t.tenant_id, null, ["owner"]);
      for (const owner of owners) {
        await notifyOnce({
          tenantId: t.tenant_id,
          userId: owner,
          title: "Yükseltme: ilan kaldırma görevi kapanmadı",
          body: `${t.title.replace(/^ACİL: /, "")} — ${hoursByTenant.get(t.tenant_id)} saattir açık. Kontrol listesini danışmanla birlikte tamamlayın.`,
          href: `/app/gorevler/eids/${t.id}`,
          kind: "danger",
          dedupeKey: `eids:escalate:${t.id}:${owner}`,
        });
      }
      const { error } = await db.from("tasks").update({ escalated_at: new Date(nowMs).toISOString() }).eq("id", t.id).eq("tenant_id", t.tenant_id).is("escalated_at", null);
      if (!error) s.escalated += 1;
    }
  }

  // 4. Eşleştir kuyruğu: günde tek bildirim (owner + gm).
  const { data: unmatched, error: umErr } = await fetchAllRowsKeepError<{ tenant_id: string; parse_kind: string | null }, { message: string; code?: string }>(
    (from, to) =>
      db.from("eids_inbound_messages").select("tenant_id, parse_kind").in("match_status", [...EIDS_MATCH_QUEUE_STATUSES]).order("id", { ascending: true }).range(from, to),
    1000,
    10,
  );
  if (umErr) {
    if (isMissingSchema(umErr)) s.schemaMissing.push("eids_inbound_messages");
    else s.errors += 1;
  } else {
    const byTenant = new Map<string, { total: number; revoke: number }>();
    for (const m of (unmatched ?? []) as { tenant_id: string; parse_kind: string | null }[]) {
      const c = byTenant.get(m.tenant_id) ?? { total: 0, revoke: 0 };
      c.total += 1;
      if (m.parse_kind === "revoke") c.revoke += 1;
      byTenant.set(m.tenant_id, c);
    }
    for (const [tenantId, c] of byTenant) {
      for (const userId of await managementRecipients(db, tenantId, null, ["owner", "gm"])) {
        const ok = await notifyOnce({
          tenantId,
          userId,
          title: c.revoke > 0 ? `ACİL: eşleşmeyen ${c.revoke} yetki iptali e-postası` : `Eşleştirilecek ${c.total} Bakanlık e-postası`,
          body:
            c.revoke > 0
              ? "İptal e-postası bir portföyle eşleşmedi; yayında bir ilan olabilir. Eşleştir kuyruğundan portföyü seçin."
              : "Bakanlık e-postaları bir portföyle birebir eşleşmedi. Eşleştir kuyruğundan doğru portföyü seçin.",
          href: "/app/ilan-kontrol/yetki?sekme=eslestir",
          kind: c.revoke > 0 ? "danger" : "warning",
          dedupeKey: `eids:unmatched:${today}:${userId}`,
        });
        if (ok) s.unmatchedNotified += 1;
      }
    }
  }

  // 5. Haftalık "Yetki doğrula" (Pazartesi, TR).
  if (trParts(nowMs).weekday === 1) s.weeklyNotified = await sendWeeklyVerifyDigest(db, nowMs);

  return s;
}

/** Haftalık özet adayları: yayında + (yetki bilinmiyor/bekliyor ya da 120 gündür teyitsiz onay). Danışman başına tek bildirim. */
async function sendWeeklyVerifyDigest(db: Db, nowMs: number): Promise<number> {
  const week = trIsoWeekKey(nowMs);
  const { data, error } = await fetchAllRowsKeepError<{ tenant_id: string; assigned_to: string; authority_eids_status: string | null }, { message: string; code?: string }>(
    (from, to) =>
      db
        .from("properties")
        .select("tenant_id, assigned_to, authority_eids_status")
        .eq("status", "live")
        .is("deleted_at", null)
        .eq("is_sample", false)
        .not("assigned_to", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    1000,
    20,
  );
  if (error) return 0;
  const settled = new Set(["approved", "revoked", "expired", "rejected"]);
  const counts = new Map<string, { tenantId: string; n: number }>();
  for (const r of (data ?? []) as { tenant_id: string; assigned_to: string; authority_eids_status: string | null }[]) {
    if (r.authority_eids_status && settled.has(r.authority_eids_status)) continue;
    const k = `${r.tenant_id}:${r.assigned_to}`;
    const c = counts.get(k) ?? { tenantId: r.tenant_id, n: 0 };
    c.n += 1;
    counts.set(k, c);
  }
  let sent = 0;
  for (const [k, c] of counts) {
    const userId = k.split(":")[1];
    const ok = await notifyOnce({
      tenantId: c.tenantId,
      userId,
      title: `Yetki doğrula: ${c.n} portföy`,
      body: "Yayındaki bu portföylerin EİDS yetkisi teyitli değil. Malikten e-Devlet ekran görüntüsü isteyin ya da portalda doğrulayıp işaretleyin.",
      href: "/app/ofis-kontrol/benim#yetki-dogrula",
      kind: "info",
      prefKey: "authority",
      dedupeKey: `eids:weekly:${week}:${userId}`,
    });
    if (ok) sent += 1;
  }
  return sent;
}
