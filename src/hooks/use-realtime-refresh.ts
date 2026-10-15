"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { now } from "@/lib/clock";
import { noteClientCacheRefreshed } from "@/lib/client-cache-state";
import {
  computeRefreshDelay,
  eventMatchesPath,
  isHomePath,
  LEGACY_PUBLICATION_TABLES,
  needsOpenWindowRefresh,
  NOTIFICATIONS_TABLE,
  parseTenantChange,
  REALTIME_BULK_MAX_WAIT_MS,
  REALTIME_BULK_QUIET_MS,
  REALTIME_DEBOUNCE_MS,
  REALTIME_HOME_MIN_INTERVAL_MS,
  REALTIME_MIN_INTERVAL_MS,
  shouldIgnoreEcho,
  type DetailRoute,
  type TenantChange,
} from "@/lib/realtime-throttle";
import {
  getLocalMutation,
  installServerActionTracker,
  loadRealtimeClient,
  onNotificationInsert,
  subscribeTopic,
  tenantTopic,
} from "@/lib/realtime";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/* Tazeleme zamanlayıcısı (saf; test edilir)                                   */
/* -------------------------------------------------------------------------- */

export type RefreshRequest = { debounceMs: number; minIntervalMs: number; bulk?: boolean };

/**
 * Sayfa başına TEK tam tazeleme zamanlayıcısı (B002/B012). Olaylar `debounceMs` birleştirilir; iki tazeleme arası en az
 * `minIntervalMs` (2 sn; ana panoda 5 sn); bekleyen tazeleme varken gelen olaylar birleşir. Toplu (bulk) olay akışı
 * REALTIME_BULK_QUIET_MS sessizlik sonrası TEK tazeleme üretir (en geç REALTIME_BULK_MAX_WAIT_MS). Sekme arkadayken
 * tazeleme yapılmaz, "bekliyor" işaretlenir; görünür olunca bir kez yapılır. Rota değişince bekleyen iş iptal edilir
 * (yeni sayfa zaten taze çekildi).
 */
export function createRefreshScheduler(deps: {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  isHidden: () => boolean;
  refresh: () => void;
}) {
  let timer: unknown = null;
  let bulkTimer: unknown = null;
  let bulkSince: number | null = null;
  let lastRefreshAt: number | null = null;
  let pendingHidden = false;
  let lastReq: RefreshRequest = { debounceMs: REALTIME_DEBOUNCE_MS, minIntervalMs: REALTIME_MIN_INTERVAL_MS };

  const clearAll = () => {
    if (timer !== null) deps.clearTimer(timer);
    if (bulkTimer !== null) deps.clearTimer(bulkTimer);
    timer = null;
    bulkTimer = null;
    bulkSince = null;
  };

  const fire = () => {
    clearAll();
    if (deps.isHidden()) {
      pendingHidden = true;
      return;
    }
    lastRefreshAt = deps.now();
    deps.refresh();
  };

  const request = (req: RefreshRequest): void => {
    lastReq = req;
    if (deps.isHidden()) {
      pendingHidden = true;
      return;
    }
    const t = deps.now();
    if (req.bulk) {
      // Toplu işlem: normal zamanlayıcı toplu akışa katılır; sessizlik sonrası tek tazeleme.
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      bulkSince ??= t;
      if (bulkTimer !== null) deps.clearTimer(bulkTimer);
      const quiet = Math.min(REALTIME_BULK_QUIET_MS, Math.max(0, bulkSince + REALTIME_BULK_MAX_WAIT_MS - t));
      bulkTimer = deps.setTimer(fire, Math.max(quiet, computeRefreshDelay(t, lastRefreshAt, 0, req.minIntervalMs)));
      return;
    }
    if (bulkSince !== null || timer !== null) return; // toplu akış ya da bekleyen tazeleme olayı kapsar
    timer = deps.setTimer(fire, computeRefreshDelay(t, lastRefreshAt, req.debounceMs, req.minIntervalMs));
  };

  return {
    request,
    /** Sekme görünür oldu: arkadayken biriken değişiklik için tek tazeleme. */
    onVisible(): void {
      if (!pendingHidden) return;
      pendingHidden = false;
      request({ ...lastReq, bulk: false });
    },
    /** Rota değişti: bekleyen tazeleme iptal (yeni sayfa zaten taze çekildi). */
    cancel(): void {
      clearAll();
      pendingHidden = false;
    },
    lastRefreshAt(): number | null {
      return lastRefreshAt;
    },
    pending(): boolean {
      return timer !== null || bulkTimer !== null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* ESKİ YOL: postgres_changes tablo kanalı (yalnız Broadcast reddedilirse)     */
/* -------------------------------------------------------------------------- */

type ChannelClient = Pick<SupabaseClient, "channel" | "removeChannel">;

/**
 * GERİ DÜŞÜŞ tablo kanalı yöneticisi (saf, React'sız; test edilir). Yalnız ofis konusuna katılım YETKİ nedeniyle
 * reddedildiğinde (Broadcast okuma politikaları kurulmadan önceki yayın penceresi) açılır; o pencerede tablolar hâlâ
 * supabase_realtime yayınındadır (LEGACY_PUBLICATION_TABLES). İstenen tablo kümesi değişince eski kanal kaldırılır,
 * yeni küme için tek `postgres_changes` kanalı açılır; küme boşsa kanal açılmaz. Konu adına sıra eklenir: aynı küme
 * hızla geri gelirse (A→B→A) ayrılmakta olan eski kanal yeniden kullanılmaz.
 * `onRejoin`: aynı kanal kopup YENİDEN katıldığında (ilk SUBSCRIBED'dan sonraki her SUBSCRIBED) çağrılır.
 */
export function createTableChannelSync(opts: {
  tenantId: string;
  onEvent: (table: string) => void;
  onRejoin?: () => void;
}) {
  const { tenantId, onEvent, onRejoin } = opts;
  let client: ChannelClient | null = null;
  let channel: RealtimeChannel | null = null;
  let openKey = "";
  let wanted: readonly string[] = [];
  let seq = 0;

  const close = () => {
    if (client && channel) void client.removeChannel(channel);
    channel = null;
    openKey = "";
  };
  const apply = () => {
    if (!client) return;
    const key = wanted.join(",");
    if (key === openKey && (channel !== null || key === "")) return;
    close();
    if (wanted.length === 0) return;
    let ch = client.channel(`es-rt:${tenantId}:${key}:${++seq}`);
    for (const table of wanted) {
      ch = ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `tenant_id=eq.${tenantId}` },
        () => onEvent(table),
      );
    }
    let joinedOnce = false;
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (joinedOnce) onRejoin?.();
      joinedOnce = true;
    });
    channel = ch;
    openKey = key;
  };

  return {
    attach(next: ChannelClient) {
      client = next;
      apply();
    },
    setTables(tables: readonly string[]) {
      const legacy = new Set<string>(LEGACY_PUBLICATION_TABLES);
      wanted = [...new Set(tables.filter((t) => legacy.has(t)))].sort();
      apply();
    },
    dispose() {
      close();
      client = null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Kanca                                                                       */
/* -------------------------------------------------------------------------- */

let sharedScheduler: ReturnType<typeof createRefreshScheduler> | null = null;
let sharedRouter: { refresh: () => void } | null = null;

/** Sayfadaki tüm kanca örnekleri (layout + İlan Kontrol) TEK zamanlayıcıyı paylaşır: aynı olay tek tazeleme. */
function pageScheduler() {
  sharedScheduler ??= createRefreshScheduler({
    now,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (t) => window.clearTimeout(t as number),
    isHidden: () => document.visibilityState === "hidden",
    refresh: () => {
      // Tazeleme TÜM istemci segment önbelleğini geçersiz kılar: tazelik kaydı yalnız bu adres için yeni (olay yayar).
      noteClientCacheRefreshed(`${window.location.pathname}?${window.location.search.replace(/^\?/, "")}`);
      sharedRouter?.refresh();
    },
  });
  return sharedScheduler;
}

/** Sayfa verisinin çekildiği an: son tazeleme ya da tam yüklemenin başlangıcı (SSR bundan sonra). */
function pageDataAt(scheduler: ReturnType<typeof createRefreshScheduler>): number {
  const origin = typeof performance !== "undefined" && performance.timeOrigin ? Math.floor(performance.timeOrigin) : now();
  return Math.max(origin, scheduler.lastRefreshAt() ?? 0);
}

/**
 * Açık sayfanın verisi başka ekranda değişince sayfayı yenile (HGDekor tarzı, ama deyim düzeyinde Broadcast ile).
 *
 * Abonelik: ofis konusu `tenant:<ofis>` (özel kanal; okuma politikası konuyu `current_tenant_id()` ile eşler), sayfada
 * TEK kanal (src/lib/realtime.ts hub'ı). Olay `t` alanına göre açık rotanın tablolarıyla (`tablesForPath`; detay
 * rotasında `detailForPath` kimliğiyle) süzülür; sabit küme için `tables` (geriye uyumlu).
 * Yankı: bu sekme son 3 sn içinde yazdıysa ve olayı aynı kullanıcı yazdıysa yok sayılır (B004; ikinci cihaz görür).
 * Açılış penceresi (B013a): kanal ilk katıldığında sayfa verisi 1 sn'den eskiyse tek tazeleme; kopup yeniden
 * katılınca tek tazeleme. Yetki reddinde (politika henüz kurulmadı) eski `postgres_changes` kanalına düşülür.
 */
export function useRealtimeRefresh(opts: {
  tenantId: string | null | undefined;
  /** Sabit tablo kümesi (`tablesForPath` yoksa). */
  tables?: readonly string[];
  /** Açık rotaya göre tablo kümesi; verilirse `tables` yerine bu kullanılır. */
  tablesForPath?: (pathname: string) => readonly string[];
  /** Detay rotası (kayıt kimliği + ilişkili tablolar): olay kimliğe göre süzülür. */
  detailForPath?: (pathname: string) => { route: DetailRoute; id: string } | null;
  enabled?: boolean;
  debounceMs?: number;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const enabled = opts.enabled !== false && Boolean(opts.tenantId);
  const tenantId = opts.tenantId;
  const debounceMs = opts.debounceMs ?? REALTIME_DEBOUNCE_MS;

  // Efektin bağımlılıkları yalnızca primitifler olsun: küme her render'da yeni dizi olabileceği için anahtar string'e indirilir.
  const active = opts.tablesForPath ? opts.tablesForPath(pathname) : (opts.tables ?? []);
  const tablesKey = [...new Set(active)].sort().join("|");
  const detail = opts.detailForPath ? opts.detailForPath(pathname) : null;
  const detailId = detail?.id ?? "";
  // Eşleme nesnesi modül sabitidir (DETAIL_ROUTES): referansı render'lar arası değişmez.
  const detailRoute = detail?.route ?? null;
  const home = Boolean(opts.tablesForPath) && isHomePath(pathname);

  const specRef = useRef<{ tables: readonly string[]; detail: { route: DetailRoute; id: string } | null; home: boolean }>({
    tables: [],
    detail: null,
    home: false,
  });
  const legacyRef = useRef<ReturnType<typeof createTableChannelSync> | null>(null);

  // Rota → süzgeç: değişince bekleyen tazeleme iptal edilir (B012: eski rotanın zamanlayıcısı yeni sayfayı yenilemesin).
  const firstRoute = useRef(true);
  useEffect(() => {
    specRef.current = {
      tables: tablesKey.split("|").filter(Boolean),
      detail: detailRoute && detailId ? { route: detailRoute, id: detailId } : null,
      home,
    };
    legacyRef.current?.setTables(specRef.current.tables);
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    if (typeof window !== "undefined") pageScheduler().cancel();
  }, [tablesKey, detailId, detailRoute, home]);

  useEffect(() => {
    if (!enabled || !tenantId) return;
    let cancelled = false;
    sharedRouter = router;
    installServerActionTracker();
    const scheduler = pageScheduler();
    let selfUserId: string | null = null;

    const request = (bulk = false) =>
      scheduler.request({
        debounceMs,
        minIntervalMs: specRef.current.home ? REALTIME_HOME_MIN_INTERVAL_MS : REALTIME_MIN_INTERVAL_MS,
        bulk,
      });

    const handle = (evt: TenantChange) => {
      const spec = specRef.current;
      if (!eventMatchesPath(evt, spec.tables, spec.detail)) return;
      if (shouldIgnoreEcho(evt, selfUserId, getLocalMutation(), now())) return;
      request(evt.bulk === true);
    };

    // Geri düşüş (yalnız yetki reddinde): eski postgres_changes kanalı, olaylar tablo adıyla aynı süzgeçten geçer.
    const legacy = createTableChannelSync({
      tenantId,
      onEvent: (table) => handle({ t: table, op: "*", by: null }),
      onRejoin: () => request(),
    });
    let legacyOn = false;
    const startLegacy = () => {
      if (legacyOn) return;
      legacyOn = true;
      legacyRef.current = legacy;
      legacy.setTables(specRef.current.tables);
      void loadRealtimeClient().then((c) => {
        if (!cancelled && legacyOn && c) legacy.attach(c);
      });
    };
    const stopLegacy = () => {
      if (!legacyOn) return;
      legacyOn = false;
      if (legacyRef.current === legacy) legacyRef.current = null;
      legacy.dispose();
    };

    void loadRealtimeClient().then(async (c) => {
      if (!c || cancelled) return;
      const { data } = await c.auth.getSession();
      selfUserId = data.session?.user?.id ?? null;
    });

    const unsubscribe = subscribeTopic(tenantTopic(tenantId), {
      on: {
        change: (payload) => {
          const evt = parseTenantChange(payload);
          if (evt) handle(evt);
        },
      },
      onStatus: (s) => {
        if (s.status === "live") {
          stopLegacy();
          // Kopup yeniden katılım: aradaki değişiklikler yeniden oynatılmaz → tek tazeleme.
          if (s.rejoin) request();
          // Açılış penceresi: SSR verisi ile ilk katılım arasında değişiklik kaybolmasın.
          else if (s.first && needsOpenWindowRefresh(now(), pageDataAt(scheduler))) request();
        } else if (s.status === "offline" && s.unauthorized) {
          startLegacy();
        }
      },
    });

    // Bildirimler (/app/bildirimler): zil köprüsünden gelen olay sanal "notifications" tablosu olarak süzülür.
    const offNotif = onNotificationInsert((row) => handle({ t: NOTIFICATIONS_TABLE, op: "INSERT", ids: [row.id], by: null }));

    const onVisible = () => {
      if (document.visibilityState === "visible") scheduler.onVisible();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      unsubscribe();
      offNotif();
      stopLegacy();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, tenantId, debounceMs, router]);
}
