"use client";

/**
 * Supabase Realtime yardımcıları (yalnızca tarayıcı).
 *
 * SK2 REALTIME-1 (2026-10-16): ofis ekranları DEYİM DÜZEYİNDE Broadcast dinler (migration 20261016020000).
 *  - Konu hub'ı (`subscribeTopic`): her konu (`tenant:<ofis>`, `inbox:<kullanıcı>`) için SAYFADA TEK özel kanal; çok
 *    tüketici (layout kancası, İlan Kontrol, destek konuşması, pano TV) aynı kanalı paylaşır. supabase-js aynı konuya
 *    ikinci `channel()` çağrısında AYNI kanalı döndürdüğü için tüketicilerin kendi kanalını açıp kapatması diğerini
 *    düşürürdü. Kanal durumu (bağlanıyor / canlı / kopuk) `getRealtimeStatus` ile okunur (DataFreshness).
 *  - Dayanıklılık: CHANNEL_ERROR, TIMED_OUT, sistem hatası ve beklenmeyen kapanışta üstel geri çekilmeyle (1-30 sn)
 *    kanal yeniden kurulur, telemetriye (error_logs, parmak izi `rt:<tür>`) sayılır; ağ geri gelince ya da sekme
 *    görünür olunca beklemeden yeniden bağlanılır. Yeniden katılım tüketiciye `rejoin` olarak bildirilir (tek tazeleme).
 *  - Yankı (B004): bu SEKME server action ile yazınca (`next-action` başlıklı POST) zaman kaydedilir; olay yalnız bu
 *    sekme son 3 sn içinde yazdıysa yok sayılır (`shouldIgnoreEcho`).
 *  - `subscribeToInserts`: tek tabloya filtreli `postgres_changes` INSERT aboneliği. YALNIZ platform personeli görünümü
 *    (destek konuşması audience="staff"; personel ofis konusuna katılamaz) için kalır.
 *  - Bildirimler: kanalı tenant bilgisine sahip tek yer (RealtimeRefresh) dinler; zil gibi tüketiciler window olayı
 *    (`onNotificationInsert`) dinler.
 */

import type { RealtimePostgresInsertPayload, SupabaseClient } from "@supabase/supabase-js";
import { runWhenIdle } from "@/lib/idle";
import { now } from "@/lib/clock";
import { REALTIME_ECHO_WINDOW_MS, realtimeBackoffMs, type LocalMutation } from "@/lib/realtime-throttle";

/** Realtime istemcisi boşta yüklenir ama açılış penceresi kısa kalsın diye en geç bu kadar ms sonra (idle-contract). */
export const REALTIME_IDLE_TIMEOUT_MS = 800;
/** Son tüketici ayrıldıktan sonra kanal bu kadar bekler (rota değişiminde ayrıl-katıl turu olmasın). */
export const TOPIC_LINGER_MS = 5_000;

/**
 * Kanal katılımı (phx_join) oturum jetonunu taşısın diye abone olmadan ÖNCE çağrılır. supabase-js jetonu oturum
 * okunduktan sonra (INITIAL_SESSION) eşzamansız verir; ondan önce abone olan kanal anon katılır, özel kanal reddedilir
 * (saha ölçümü 2026-10-15: doğrudan açılan /app sayfalarında 150 sn'de 0 olay).
 * Argümansız setAuth istemcinin jeton geri çağrısını (oturum) kullanır; yenilenen jeton da aynı yoldan gider.
 */
export async function ensureRealtimeAuth(client: { realtime: { setAuth: (token?: string | null) => Promise<void> } }): Promise<void> {
  try {
    await client.realtime.setAuth();
  } catch {
    // Jeton alınamadı: kanal yine açılır; reddedilirse hub geri çekilmeyle yeniden dener.
  }
}

let clientPromise: Promise<SupabaseClient | null> | null = null;

/** Paylaşılan tarayıcı istemcisi (supabase-js ayrı parça; boşta, en geç REALTIME_IDLE_TIMEOUT_MS sonra yüklenir). */
export function loadRealtimeClient(): Promise<SupabaseClient | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  clientPromise ??= new Promise<SupabaseClient | null>((resolve) => {
    runWhenIdle(
      () =>
        void import("@/lib/supabase/client")
          .then(async ({ createClient }) => {
            const supabase = createClient();
            // Jeton katılımdan ÖNCE: yoksa kanal anon katılır ve özel konu reddedilir.
            await ensureRealtimeAuth(supabase);
            resolve(supabase);
          })
          .catch(() => {
            clientPromise = null;
            resolve(null);
          }),
      { timeoutMs: REALTIME_IDLE_TIMEOUT_MS },
    );
  });
  return clientPromise;
}

/* -------------------------------------------------------------------------- */
/* Konu hub'ı                                                                  */
/* -------------------------------------------------------------------------- */

export type RealtimeStatus = "idle" | "connecting" | "live" | "offline";

export type TopicStatusEvent = {
  status: RealtimeStatus;
  /** Bu kanalın İLK SUBSCRIBED'ı (sayfa açılışı; açılış penceresi için tek tazeleme kararı). */
  first: boolean;
  /** Kopup YENİDEN katılım (aradaki değişiklikler yeniden oynatılmaz: tek tazeleme). */
  rejoin: boolean;
  /** Katılım yetki nedeniyle reddedildi (okuma politikası yok / oturum yok). */
  unauthorized: boolean;
};

export type TopicHandlers = {
  /** Broadcast olay adı ("change", "notification") → işleyici (yük = realtime.send payload'ı). */
  on?: Readonly<Record<string, (payload: unknown) => void>>;
  onStatus?: (e: TopicStatusEvent) => void;
};

type BroadcastMessage = { event?: string; payload?: unknown };
type SystemMessage = { status?: string; message?: string };

/** Hub'ın kullandığı en küçük kanal yüzeyi (test sahte kanalla sürer). */
export type HubChannel = {
  on(type: "broadcast", filter: { event: string }, cb: (msg: BroadcastMessage) => void): HubChannel;
  on(type: "system", filter: Record<string, never>, cb: (msg: SystemMessage) => void): HubChannel;
  subscribe(cb: (status: string, err?: Error) => void): HubChannel;
};

export type HubClient = {
  channel(topic: string, params: { config: { private: boolean } }): HubChannel;
  removeChannel(ch: HubChannel): Promise<unknown>;
  realtime?: { isConnected(): boolean; connect(): void };
};

export type HubDeps = {
  loadClient: () => Promise<HubClient | null>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  random?: () => number;
  /** Telemetri: abonelik hatası (tür, konu, ayrıntı). */
  report?: (kind: string, topic: string, detail?: string) => void;
};

type Entry = {
  topic: string;
  handlers: Set<TopicHandlers>;
  client: HubClient | null;
  channel: HubChannel | null;
  status: RealtimeStatus;
  everLive: boolean;
  unauthorized: boolean;
  attempt: number;
  gen: number;
  building: boolean;
  closing: Promise<void> | null;
  retryTimer: unknown;
  lingerTimer: unknown;
};

const UNAUTHORIZED_RE = /unauthori[sz]ed|permission|not allowed|forbidden|denied/i;
/**
 * Realtime kiracı sınırı reddi (B014: max_concurrent_users / katılım / olay hızı; _realtime.tenants). Telemetride AYRI tür
 * (`rt:LIMIT:<önek>`) olarak sayılır; sunucu tarafı %80 uyarısı scripts/sunucu/realtime-capacity-check.sh.
 */
const LIMIT_RE = /too many|too_many|rate ?limit|ratelimit|limit reached|max_concurrent|maxconcurrent/i;

/** Abonelik hatasının telemetri türü: yetki reddi > sınır reddi > ham durum. */
export function realtimeIssueKind(kind: string, detail: string | undefined, unauthorized: boolean): string {
  if (unauthorized) return "UNAUTHORIZED";
  if (detail && LIMIT_RE.test(detail)) return "LIMIT";
  return kind;
}

/** Konu başına tek kanal, referans sayımlı tüketiciler, durum yayını ve geri çekilmeli yeniden kurulum (saf; test edilir). */
export function createTopicHub(deps: HubDeps) {
  const entries = new Map<string, Entry>();
  const statusListeners = new Set<() => void>();

  const notifyStatusListeners = () => statusListeners.forEach((cb) => cb());

  const emit = (e: Entry, ev: Omit<TopicStatusEvent, "unauthorized">) => {
    const full: TopicStatusEvent = { ...ev, unauthorized: e.unauthorized };
    for (const h of [...e.handlers]) h.onStatus?.(full);
  };

  const setStatus = (e: Entry, status: RealtimeStatus) => {
    if (e.status === status) return;
    e.status = status;
    notifyStatusListeners();
  };

  const clearRetry = (e: Entry) => {
    if (e.retryTimer !== null) deps.clearTimer(e.retryTimer);
    e.retryTimer = null;
  };

  const dispatch = (e: Entry, msg: BroadcastMessage) => {
    const event = typeof msg?.event === "string" ? msg.event : "";
    if (!event) return;
    for (const h of [...e.handlers]) {
      try {
        h.on?.[event]?.(msg.payload);
      } catch {
        // Tek tüketicinin hatası diğerlerini ve kanalı düşürmez.
      }
    }
  };

  const onLive = (e: Entry) => {
    clearRetry(e);
    e.attempt = 0;
    e.unauthorized = false;
    const first = !e.everLive;
    e.everLive = true;
    setStatus(e, "live");
    emit(e, { status: "live", first, rejoin: !first });
  };

  const teardownChannel = async (e: Entry) => {
    e.gen += 1; // eski kanalın geç gelen geri çağrıları yok sayılır
    const ch = e.channel;
    const client = e.client;
    e.channel = null;
    if (!ch || !client) return;
    const closing = client.removeChannel(ch).then(
      () => undefined,
      () => undefined,
    );
    e.closing = closing;
    await closing;
    if (e.closing === closing) e.closing = null;
  };

  const build = async (e: Entry) => {
    if (e.building || e.channel) return;
    e.building = true;
    try {
      const client = await deps.loadClient();
      // supabase-js aynı konuya açık kanal varken onu döndürür: ayrılmakta olan kanal tamamen kapanmadan yenisi kurulmaz.
      while (e.closing) await e.closing;
      if (!client || e.handlers.size === 0 || e.channel) return;
      const gen = ++e.gen;
      e.client = client;
      setStatus(e, "connecting");
      const ch = client
        .channel(e.topic, { config: { private: true } })
        .on("broadcast", { event: "*" }, (msg) => {
          if (gen === e.gen) dispatch(e, msg);
        })
        .on("system", {}, (msg) => {
          if (gen === e.gen && msg?.status === "error") fail(e, "SYSTEM_ERROR", msg.message);
        });
      e.channel = ch;
      ch.subscribe((status, err) => {
        if (gen !== e.gen) return;
        if (status === "SUBSCRIBED") onLive(e);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") fail(e, status, err?.message);
        else if (status === "CLOSED") fail(e, "CLOSED");
      });
    } finally {
      e.building = false;
    }
  };

  const rebuild = async (e: Entry) => {
    await teardownChannel(e);
    await build(e);
  };

  const scheduleRetry = (e: Entry) => {
    if (e.retryTimer !== null || e.handlers.size === 0) return;
    const delay = realtimeBackoffMs(e.attempt, (deps.random?.() ?? 0) * 250);
    e.attempt += 1;
    e.retryTimer = deps.setTimer(() => {
      e.retryTimer = null;
      void rebuild(e);
    }, delay);
  };

  function fail(e: Entry, kind: string, detail?: string) {
    if (detail && UNAUTHORIZED_RE.test(detail)) e.unauthorized = true;
    setStatus(e, "offline");
    emit(e, { status: "offline", first: false, rejoin: false });
    deps.report?.(realtimeIssueKind(kind, detail, e.unauthorized), e.topic, detail);
    scheduleRetry(e);
  }

  const entryFor = (topic: string): Entry => {
    let e = entries.get(topic);
    if (!e) {
      e = {
        topic,
        handlers: new Set(),
        client: null,
        channel: null,
        status: "idle",
        everLive: false,
        unauthorized: false,
        attempt: 0,
        gen: 0,
        building: false,
        closing: null,
        retryTimer: null,
        lingerTimer: null,
      };
      entries.set(topic, e);
    }
    return e;
  };

  return {
    subscribe(topic: string, handlers: TopicHandlers): () => void {
      const e = entryFor(topic);
      if (e.lingerTimer !== null) {
        deps.clearTimer(e.lingerTimer);
        e.lingerTimer = null;
      }
      e.handlers.add(handlers);
      if (!e.channel && !e.building) void build(e);
      else if (e.status !== "idle") {
        // Kanal zaten açık: yeni tüketici mevcut durumu öğrenir (ilk katılım / yeniden katılım SAYILMAZ).
        const snapshot = { status: e.status, first: false, rejoin: false, unauthorized: e.unauthorized };
        void Promise.resolve().then(() => {
          if (e.handlers.has(handlers)) handlers.onStatus?.(snapshot);
        });
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        e.handlers.delete(handlers);
        if (e.handlers.size > 0) return;
        e.lingerTimer = deps.setTimer(() => {
          e.lingerTimer = null;
          if (e.handlers.size > 0) return;
          clearRetry(e);
          e.attempt = 0;
          e.everLive = false;
          e.unauthorized = false;
          setStatus(e, "idle");
          void teardownChannel(e);
        }, TOPIC_LINGER_MS);
      };
    },
    status(topic: string): RealtimeStatus {
      return entries.get(topic)?.status ?? "idle";
    },
    /** Önekli konuların ortak durumu: biri canlıysa canlı; hiç yoksa idle. */
    statusOf(prefix: string): RealtimeStatus {
      const list = [...entries.values()].filter((e) => e.topic.startsWith(prefix) && e.handlers.size > 0);
      if (list.length === 0) return "idle";
      if (list.some((e) => e.status === "live")) return "live";
      if (list.some((e) => e.status === "offline")) return "offline";
      return "connecting";
    },
    onStatusChange(cb: () => void): () => void {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    /** Ağ geri geldi / sekme görünür oldu: kopuk kanallar beklemeden yeniden kurulur. */
    reconnectNow(): void {
      for (const e of entries.values()) {
        // Katılımı süren kanal (connecting) bozulmaz: sekme hızlı gidip gelince kur-kapat turu olmasın.
        if (e.handlers.size === 0 || e.status === "live" || e.building || (e.status === "connecting" && e.channel)) continue;
        clearRetry(e);
        e.attempt = 0;
        const rt = e.client?.realtime;
        if (rt && !rt.isConnected()) rt.connect();
        void rebuild(e);
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Sayfa hub'ı (tarayıcı tekil)                                                */
/* -------------------------------------------------------------------------- */

const REPORT_GAP_MS = 60_000;
const lastReport = new Map<string, number>();

/** Abonelik hatası telemetrisi (error_logs; aynı tür + konu öneki dakikada en çok bir kez). Kişisel veri yok. */
function reportRealtimeIssue(kind: string, topic: string, detail?: string): void {
  if (typeof window === "undefined") return;
  const prefix = topic.split(":", 1)[0] || "topic";
  const key = `${kind}:${prefix}`;
  const t = now();
  if (t - (lastReport.get(key) ?? -Infinity) < REPORT_GAP_MS) return;
  lastReport.set(key, t);
  const message = `realtime ${kind} (${prefix})${detail ? `: ${detail.replace(/[0-9a-f-]{36}/gi, "<id>").slice(0, 160)}` : ""}`;
  void import("@/app/actions/report-error")
    .then(({ reportClientError }) => reportClientError({ message, digest: `rt:${key}`, path: window.location.pathname }))
    .catch(() => undefined);
}

let hub: ReturnType<typeof createTopicHub> | null = null;
let statusSince = 0;
let lastAggregate: RealtimeStatus = "idle";

function pageHub(): ReturnType<typeof createTopicHub> | null {
  if (typeof window === "undefined") return null;
  if (!hub) {
    const created = createTopicHub({
      loadClient: loadRealtimeClient as () => Promise<HubClient | null>,
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (t) => window.clearTimeout(t as number),
      random: Math.random,
      report: reportRealtimeIssue,
    });
    hub = created;
    statusSince = now();
    // Ofis konusu durum değişim anı (ilk dinleyici: diğer dinleyiciler güncel anı okur).
    created.onStatusChange(() => {
      const next = created.statusOf("tenant:");
      if (next === lastAggregate) return;
      lastAggregate = next;
      statusSince = now();
    });
    // Ağ dönünce realtime-js'in artan bekleme aralığını (1/2/5/10 sn) beklemeden bağlan; sekme görünür olunca da.
    window.addEventListener("online", () => created.reconnectNow());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") created.reconnectNow();
    });
  }
  return hub;
}

/** Konuya abone ol (sayfada tek kanal paylaşılır). Dönen fonksiyon aboneliği bırakır. */
export function subscribeTopic(topic: string, handlers: TopicHandlers): () => void {
  return pageHub()?.subscribe(topic, handlers) ?? (() => {});
}

export const tenantTopic = (tenantId: string) => `tenant:${tenantId}`;
export const inboxTopic = (userId: string) => `inbox:${userId}`;

/* Etkin ofis: layout (RealtimeRefresh) yazar; ofis kimliği prop'u gelmeyen bileşenler (destek konuşması) okur. */
let activeTenantId: string | null = null;
const activeTenantListeners = new Set<() => void>();

export function setActiveTenantId(id: string | null): void {
  if (activeTenantId === id) return;
  activeTenantId = id;
  activeTenantListeners.forEach((cb) => cb());
}

export function getActiveTenantId(): string | null {
  return activeTenantId;
}

export function onActiveTenantChange(cb: () => void): () => void {
  activeTenantListeners.add(cb);
  return () => activeTenantListeners.delete(cb);
}

/** Ofis konusunun canlı bağlantı durumu ("idle": bu sayfada ofis aboneliği yok, ör. /admin). */
export function getRealtimeStatus(): RealtimeStatus {
  return hub?.statusOf("tenant:") ?? "idle";
}

/** Ofis konusu durumunun en son değiştiği an (bağlanamama süresi; DataFreshness toleransı). */
export function getRealtimeStatusSince(): number {
  return statusSince;
}

export function subscribeRealtimeStatus(cb: () => void): () => void {
  return pageHub()?.onStatusChange(cb) ?? (() => {});
}

/* -------------------------------------------------------------------------- */
/* Yankı: bu sekmenin son yazımı (B004)                                        */
/* -------------------------------------------------------------------------- */

let localMutation: LocalMutation | null = null;

/** Bu sekme yazdı (tablolar biliniyorsa onlar; yoksa "*" = olayı yazan kullanıcıyla eşlenir). */
export function noteLocalMutation(tables?: readonly string[]): void {
  const t = now();
  const prev = localMutation && t - localMutation.at <= REALTIME_ECHO_WINDOW_MS ? localMutation : null;
  if (!tables || tables.length === 0 || prev?.tables === "*") {
    localMutation = { at: t, tables: "*" };
    return;
  }
  localMutation = { at: t, tables: new Set([...(prev ? [...prev.tables] : []), ...tables]) };
}

export function getLocalMutation(): LocalMutation | null {
  return localMutation;
}

function hasActionHeader(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.has("next-action");
  if (Array.isArray(headers)) return headers.some(([k]) => k.toLowerCase() === "next-action");
  return Object.keys(headers).some((k) => k.toLowerCase() === "next-action");
}

let trackerInstalled = false;

/**
 * Server action sarmalayıcısı: Next istemcisi her server action'ı `next-action` başlıklı POST ile gönderir; çağrı anı
 * bu sekmenin "son yazımı" olarak kaydedilir. Tek kez kurulur; istek değiştirilmez.
 */
export function installServerActionTracker(): void {
  if (trackerInstalled || typeof window === "undefined" || typeof window.fetch !== "function") return;
  trackerInstalled = true;
  const original = window.fetch;
  const tracked = function (input: RequestInfo | URL, init?: RequestInit) {
    if (init?.method === "POST" && hasActionHeader(init.headers)) noteLocalMutation();
    return original.call(window, input, init);
  } as typeof window.fetch;
  window.fetch = tracked;
}

/* -------------------------------------------------------------------------- */
/* postgres_changes INSERT (yalnız personel görünümü)                          */
/* -------------------------------------------------------------------------- */

export function subscribeToInserts<T extends Record<string, unknown>>(opts: {
  /** Kanal adı benzersiz olmalı (ör. `es-rt-ticket:${id}`). */
  channel: string;
  table: string;
  /** postgres_changes filtresi, ör. `ticket_id=eq.${id}` (RLS yine de geçerli). */
  filter?: string;
  onInsert: (row: T) => void;
}): () => void {
  // supabase-js (~100 KB) yalnızca abonelik gerçekten kurulurken indirilir.
  let cancelled = false;
  let cleanup: (() => void) | null = null;
  void loadRealtimeClient().then((supabase) => {
    if (cancelled || !supabase) return;
    const channel = supabase
      .channel(opts.channel)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: opts.table,
          ...(opts.filter ? { filter: opts.filter } : {}),
        },
        (payload: RealtimePostgresInsertPayload<T>) => opts.onInsert(payload.new),
      )
      .subscribe();
    cleanup = () => {
      void supabase.removeChannel(channel);
    };
  });
  return () => {
    cancelled = true;
    cleanup?.();
  };
}

/* -------------------------------------------------------------------------- */
/* Bildirim köprüsü                                                            */
/* -------------------------------------------------------------------------- */

/** Zile giden bildirim satırı: kişisel bildirimde `inbox:<uid>` yükü, ortak bildirimde RLS'li okuma (sözleşme j). */
export type NotificationInsertRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  title: string;
  body: string | null;
  href: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
};

export const NOTIFICATION_ROW_FIELDS = ["id", "tenant_id", "user_id", "title", "body", "href", "kind", "read_at", "created_at"] as const;

/** Broadcast / select yükünü NotificationInsertRow'a doğrular; eksik zorunlu alan varsa null. */
export function toNotificationRow(value: unknown): NotificationInsertRow | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
  const id = str("id");
  const tenantId = str("tenant_id");
  const title = str("title");
  const kind = str("kind");
  const createdAt = str("created_at");
  if (!id || !tenantId || title === null || !kind || !createdAt) return null;
  return {
    id,
    tenant_id: tenantId,
    user_id: str("user_id"),
    title,
    body: str("body"),
    href: str("href"),
    kind,
    read_at: str("read_at"),
    created_at: createdAt,
  };
}

export const NOTIF_INSERT_EVENT = "es:notification-insert";

export function emitNotificationInsert(row: NotificationInsertRow): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NotificationInsertRow>(NOTIF_INSERT_EVENT, { detail: row }));
}

export function onNotificationInsert(cb: (row: NotificationInsertRow) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<NotificationInsertRow>).detail);
  window.addEventListener(NOTIF_INSERT_EVENT, handler);
  return () => window.removeEventListener(NOTIF_INSERT_EVENT, handler);
}
