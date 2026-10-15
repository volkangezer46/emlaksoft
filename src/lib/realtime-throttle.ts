/**
 * Realtime yenileme için saf yardımcılar (hook'tan ayrı: test edilebilir).
 *
 * SK2 REALTIME-1 (2026-10-16): ofis ekranları artık `postgres_changes` DEĞİL, DEYİM DÜZEYİNDE Broadcast dinler
 * (migration 20261016020000). Her yazım deyimi, dokunduğu her ofis için `tenant:<tenant_id>` konusuna TEK mesaj atar:
 * `{t, op, ids (≤50), r (üst kimlik), by}`; 50'den fazla satırda `{t, op, bulk:true}`. Kişisel veri yok.
 * İstemci TEK özel kanala (ofis konusu) katılır; bir tablonun sorunu kanalı düşürmez. Olay `t` alanına göre açık rotanın
 * tablo kümesiyle (`tablesForPath`, kaynak `ROUTE_TABLES`) ve detay rotasında kayıt kimliğiyle (`detailForPath`) süzülür.
 *
 * Fırtına önleme: olaylar 150 ms birleştirilir; iki tam tazeleme arası en az REALTIME_MIN_INTERVAL_MS (2 sn), ana
 * panoda REALTIME_HOME_MIN_INTERVAL_MS (5 sn); toplu (bulk) olay akışı sessizlik sonrası TEK tazeleme üretir.
 * Saha ölçümü (2026-10-15): commit → WS olayı medyan ~300 ms; 10 sn alt sınır art arda ikinci değişikliği 5–9 sn
 * geciktiriyordu.
 */

export const REALTIME_DEBOUNCE_MS = 150;
export const REALTIME_MIN_INTERVAL_MS = 2_000;
/** Ana pano tüm merkezlerin özetini yeniden çizer (229-326 ms / ~156 KB RSC): daha seyrek. */
export const REALTIME_HOME_MIN_INTERVAL_MS = 5_000;
/** Toplu işlem (içe aktarma, toplu atama) olay akışı bu kadar sessiz kalınca TEK tazeleme. */
export const REALTIME_BULK_QUIET_MS = 1_500;
/** Toplu akış hiç susmasa da en geç bu kadar sonra tazelenir (sayfa sonsuza dek eski kalmasın). */
export const REALTIME_BULK_MAX_WAIT_MS = 30_000;
/** Bu sekme bu süre içinde yazdıysa kendi yankısı yok sayılır (B004: sekme bazlı, kullanıcı bazlı DEĞİL). */
export const REALTIME_ECHO_WINDOW_MS = 3_000;
/** İlk katılımda sayfa verisi bundan eskiyse tek tazeleme (SSR ile ilk SUBSCRIBED arasındaki açılış penceresi). */
export const REALTIME_OPEN_WINDOW_MS = 1_000;

/**
 * Deyim düzeyinde Broadcast tetikleyicisi bağlı tablolar (20261016020000; sözleşme testi migration listesiyle iki yönlü
 * eşler). `notifications` burada YOK: satır düzeyinde ayrı tetikleyiciyle `inbox:<uid>` / ofis konusuna `notification`
 * olayı olarak gider.
 */
export const BROADCAST_TABLES = [
  "appointments",
  "approval_requests",
  "branches",
  "calls",
  "cash_entries",
  "commissions",
  "communications",
  "contracts",
  "customer_demands",
  "customers",
  "deal_notes",
  "deals",
  "finance_open_items",
  "finance_parties",
  "fsbo_leads",
  "listing_control_events",
  "listing_pool_entries",
  "offers",
  "portal_listings",
  "profiles",
  "properties",
  "property_keys",
  "rent_charges",
  "rent_payments",
  "support_ticket_attachments",
  "support_ticket_messages",
  "support_tickets",
  "targets",
  "tasks",
  "teams",
] as const;

/** Bildirim olayları (kişisel ya da ortak) hook'a bu sanal tablo adıyla girer (/app/bildirimler). */
export const NOTIFICATIONS_TABLE = "notifications";

/**
 * ESKİ YOL (yalnız geri düşüş): Broadcast okuma politikaları kurulmadan önce (yayın notu, supabase_admin) özel kanal
 * katılımı reddedilir. O pencerede hâlâ supabase_realtime yayınında olan tablolar (2026-10-15, 21 tablonun 19'u)
 * `postgres_changes` ile dinlenir. Yayın kırpması (20261016020100) politikalar kurulmadan çalışmaz.
 */
export const LEGACY_PUBLICATION_TABLES = [
  "appointments",
  "cash_entries",
  "commissions",
  "customer_demands",
  "customers",
  "deals",
  "finance_open_items",
  "finance_parties",
  "fsbo_leads",
  "listing_control_events",
  "listing_pool_entries",
  "offers",
  "portal_listings",
  "properties",
  "property_keys",
  "rent_charges",
  "rent_payments",
  "tasks",
] as const;

/** Her /app rotasında dinlenen tablolar: menü rozeti (bekleyen onay) layout'ta çizilir. */
export const GLOBAL_TABLES: readonly string[] = ["approval_requests"];

/** Rota öneki → o sayfada tazelenmesi anlamlı tablolar (canlı verinin TEK kaynağı; daha özel önek önce). */
export const ROUTE_TABLES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/app/musteriler", ["customers"]],
  ["/app/komisyon", ["commissions"]],
  ["/app/anlasmalar", ["deals", "commissions"]],
  ["/app/ilan-kontrol/portallar", ["portal_listings"]],
  ["/app/portfoyler/anahtarlar", ["property_keys", "properties"]],
  ["/app/portfoyler", ["portal_listings", "properties"]],
  ["/app/talepler", ["customer_demands"]],
  ["/app/randevular", ["appointments"]],
  ["/app/gorevler", ["tasks"]],
  ["/app/ilan-havuzu", ["listing_pool_entries", "properties"]],
  ["/app/giderler", ["cash_entries", "finance_open_items", "finance_parties"]],
  ["/app/kiralama", ["deals", "properties", "rent_charges", "rent_payments"]],
  ["/app/aidat", ["rent_charges", "rent_payments"]],
  ["/app/kira-artis", ["rent_charges", "properties"]],
  ["/app/teklifler", ["offers", "deals"]],
  ["/app/cuzdan", ["commissions"]],
  ["/app/portfoy-avi", ["fsbo_leads"]],
  // SK2 (B005/B007/B008): onay, yönetim, destek, gelen kutusu, bildirim ve sözleşme ekranları.
  ["/app/onaylar", ["approval_requests"]],
  ["/app/hedefler", ["targets", "deals", "commissions", "appointments"]],
  ["/app/lig", ["deals", "commissions", "targets", "profiles"]],
  ["/app/ekip", ["profiles", "branches", "teams", "targets"]],
  ["/app/ofis-kontrol", ["approval_requests", "tasks", "properties", "portal_listings", "customers"]],
  ["/app/destek", ["support_tickets"]],
  ["/app/gelen-kutusu", ["calls", "communications"]],
  ["/app/bildirimler", [NOTIFICATIONS_TABLE]],
  ["/app/sozlesmeler", ["contracts"]],
];

/**
 * Detay rotaları: `<önek>/<uuid>` kendi kaydını (`self`, olay `ids`) ve ilişkili kayıtları (`related`, olay `r` = üst
 * kimlik; tetikleyici argümanı customer_id / deal_id) KİMLİKLE süzer: başka müşterinin görevi bu sayfayı tazelemez.
 */
export type DetailRoute = { prefix: string; self: string; related: readonly string[] };
export const DETAIL_ROUTES: readonly DetailRoute[] = [
  {
    prefix: "/app/musteriler",
    self: "customers",
    related: ["tasks", "appointments", "calls", "communications", "deals", "offers", "customer_demands"],
  },
  { prefix: "/app/anlasmalar", self: "deals", related: ["commissions", "deal_notes"] },
];

/**
 * Canlı veriyi sayfanın KENDİ bileşeni yönetir (layout kancası bu rotada tam tazeleme yapmaz; çift tazeleme olmasın).
 * Sözleşme: src/lib/realtime-route-contract.test.ts bileşenin ofis konusuna abone olduğunu doğrular.
 */
export const COMPONENT_LIVE_ROUTES: Readonly<Record<string, string>> = {
  "/app/destek/[id]": "src/app/app/destek/[id]/ticket-thread.tsx",
  "/app/ilan-kontrol": "src/components/listing-control/live-refresh.tsx",
  "/app/pano-tv": "src/app/app/pano-tv/tv-hooks.ts",
};

/**
 * Menüde olup bilerek CANLI OLMAYAN rotalar (gerekçeli). Önbellek tazelemesi (ClientCacheSync) ve mutasyon
 * revalidate'i yeter: ayar/yardım/hesaplayıcı ekranları, cron'la hesaplanan rapor/analiz sayfaları ve Broadcast
 * kapsamında olmayan tablolar. Sözleşme: menüdeki her rota ya eşlemede ya burada.
 */
export const NOT_LIVE_ROUTES: Readonly<Record<string, string>> = {
  "/app/abonelik": "abonelik/fatura: platform tarafı, ofis yazımı yok",
  "/app/acik-ev": "açık ev etkinlikleri Broadcast kapsamında değil",
  "/app/ag": "ofisler arası ağ: başka ofislerin verisi, ofis konusu taşımaz",
  "/app/anketler": "anket yanıtları herkese açık uçtan, seyrek",
  "/app/asistan": "sohbet ekranı; veri değişikliği göstermez",
  "/app/ayarlar": "ayar ekranları; kaydeden sekme revalidate eder",
  "/app/belgeler": "belge arşivi Broadcast kapsamında değil",
  "/app/bolge-analizi": "analiz (toplu hesap); canlı değil",
  "/app/buyume": "büyüme/davet ekranı; canlı değil",
  "/app/danisman-kpi": "dönemsel KPI raporu; canlı değil",
  "/app/degerleme": "değerleme araçları; canlı değil",
  "/app/franchise": "franchise özeti (çok ofis); canlı değil",
  "/app/hesaplayici": "hesaplayıcı; veri yok",
  "/app/kampanyalar": "kampanya gönderimleri Broadcast kapsamında değil",
  "/app/mahalle-notlari": "mahalle notları Broadcast kapsamında değil",
  "/app/otomasyonlar": "otomasyon tanımları; kaydeden sekme revalidate eder",
  "/app/performansim": "kişisel dönem raporu; canlı değil",
  "/app/projeler": "projeler Broadcast kapsamında değil",
  "/app/raporlar": "raporlar (önbellekli toplamlar); canlı değil",
  "/app/tavsiyeler": "tavsiye bağlantıları herkese açık uçtan, seyrek",
  "/app/uyum": "uyum kontrol listesi; canlı değil",
  "/app/yabanci-satis": "rehber/hesap ekranı; canlı değil",
  "/app/yardim": "yardım içeriği; veri yok",
};

/** Ana pano (/app) yalnız GÖSTERDİĞİ özetlerin tabloları (B002: 17 tablo yerine pano kartları). */
export const HOME_TABLES: readonly string[] = [
  "tasks",
  "appointments",
  "customers",
  "customer_demands",
  "calls",
  "deals",
  "commissions",
  "properties",
  "targets",
  "approval_requests",
];

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizePath(pathname: string | null | undefined): string {
  return (pathname ?? "").split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
}

function uniq(list: readonly string[]): readonly string[] {
  return [...new Set(list)];
}

/** Detay rotası: `<önek>/<uuid>` (alt yolları dahil) ise kimlik ve eşleme; değilse null. */
export function detailForPath(pathname: string | null | undefined): { route: DetailRoute; id: string } | null {
  const p = normalizePath(pathname);
  for (const route of DETAIL_ROUTES) {
    if (!p.startsWith(`${route.prefix}/`)) continue;
    const seg = p.slice(route.prefix.length + 1).split("/", 1)[0];
    if (UUID_SEGMENT.test(seg)) return { route, id: seg.toLowerCase() };
  }
  return null;
}

function matchesComponentPattern(p: string, pattern: string): boolean {
  if (!pattern.includes("[id]")) return p === pattern || p.startsWith(`${pattern}/`);
  const parts = pattern.split("/");
  const segs = p.split("/");
  return segs.length === parts.length && parts.every((part, i) => (part === "[id]" ? UUID_SEGMENT.test(segs[i] ?? "") : part === segs[i]));
}

/** Canlı verisini kendi bileşeni yöneten rota mı? (`[id]` tek uuid kesimiyle eşleşir.) */
export function isComponentLivePath(pathname: string | null | undefined): boolean {
  const p = normalizePath(pathname);
  return Object.keys(COMPONENT_LIVE_ROUTES).some((pattern) => matchesComponentPattern(p, pattern));
}

/**
 * Açık rotada tazelenmesi anlamlı tablolar. Ana pano özet tablolarını; detay rotası kendi + ilişkili tabloları;
 * konuşma gibi bileşeni yöneten kayıt rotası (`[id]`) yalnız ortak tabloları; /app dışı hiçbirini döndürür.
 * /app altındaki her rota ortak tabloları (GLOBAL_TABLES: menü rozeti) içerir.
 */
export function tablesForPath(pathname: string | null | undefined): readonly string[] {
  const p = normalizePath(pathname);
  if (p !== "/app" && !p.startsWith("/app/")) return [];
  if (p === "/app") return uniq([...HOME_TABLES, ...GLOBAL_TABLES]);
  const detail = detailForPath(p);
  if (detail) return uniq([detail.route.self, ...detail.route.related, ...GLOBAL_TABLES]);
  if (Object.keys(COMPONENT_LIVE_ROUTES).some((pattern) => pattern.includes("[id]") && matchesComponentPattern(p, pattern))) {
    return [...GLOBAL_TABLES];
  }
  for (const [prefix, tables] of ROUTE_TABLES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return uniq([...tables, ...GLOBAL_TABLES]);
  }
  return [...GLOBAL_TABLES];
}

/**
 * Tablo → verisini gösteren rota önekleri: değişiklik olunca KAPALI rotaların istemci önbelleği geçersizlenir (B010;
 * dönüşte arkadan tazelenir). Ortak tablolar (menü rozeti) yalnız kendi ekranlarını geçersizler.
 */
export function routesForTable(table: string): readonly string[] {
  const out = new Set<string>();
  if (HOME_TABLES.includes(table)) out.add("/app");
  for (const [prefix, tables] of ROUTE_TABLES) if (tables.includes(table)) out.add(prefix);
  for (const d of DETAIL_ROUTES) if (d.self === table || d.related.includes(table)) out.add(d.prefix);
  return [...out];
}

/** Ana pano mu? (daha seyrek tam tazeleme) */
export function isHomePath(pathname: string | null | undefined): boolean {
  return normalizePath(pathname) === "/app";
}

/** `tenant:<id>` konusundaki `change` olayının yükü (20261016020000). */
export type TenantChange = {
  t: string;
  op: string;
  ids?: readonly string[];
  r?: readonly string[];
  by?: string | null;
  bulk?: boolean;
};

const strArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : undefined;

/** Ham Broadcast yükünü doğrular (bilinmeyen alanlar atılır); geçersizse null. */
export function parseTenantChange(payload: unknown): TenantChange | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.t !== "string" || !o.t || typeof o.op !== "string") return null;
  return {
    t: o.t,
    op: o.op,
    ids: strArray(o.ids),
    r: strArray(o.r),
    by: typeof o.by === "string" ? o.by : null,
    bulk: o.bulk === true,
  };
}

/**
 * Olay açık sayfayı ilgilendiriyor mu? Tablo kümesinde değilse hayır. Detay rotasında kendi tablosu `ids`, ilişkili
 * tablolar `r` içinde kaydın kimliğini taşımalı; toplu (bulk) ya da kimliksiz olay her zaman ilgilidir (güvenli taraf).
 */
export function eventMatchesPath(
  evt: TenantChange,
  tables: readonly string[],
  detail: { route: DetailRoute; id: string } | null,
): boolean {
  if (!tables.includes(evt.t)) return false;
  if (!detail || evt.bulk) return true;
  if (evt.t === detail.route.self) return !evt.ids || evt.ids.includes(detail.id);
  if (detail.route.related.includes(evt.t)) return !evt.r || evt.r.includes(detail.id);
  return true;
}

/**
 * Bir olay geldiğinde yenilemeden önce beklenecek süre (ms).
 * Hiç yenileme yapılmadıysa yalnız debounce; yakın zamanda yapıldıysa son yenilemeden itibaren minInterval dolana kadar.
 */
export function computeRefreshDelay(
  nowMs: number,
  lastRefreshAtMs: number | null,
  debounceMs: number,
  minIntervalMs: number = REALTIME_MIN_INTERVAL_MS,
): number {
  if (lastRefreshAtMs === null) return Math.max(0, debounceMs);
  const untilAllowed = lastRefreshAtMs + minIntervalMs - nowMs;
  return Math.max(0, debounceMs, untilAllowed);
}

/** Bu sekmenin son yerel yazımı (server action): zaman + tablolar ("*" = bilinmiyor, kullanıcıya göre eşlenir). */
export type LocalMutation = { at: number; tables: ReadonlySet<string> | "*" };

/**
 * Olay bu SEKMENİN kendi yazımının yankısı mı? (B004) Yalnız bu sekme son REALTIME_ECHO_WINDOW_MS içinde yazdıysa ve
 * olayı yazan aynı kullanıcıysa (`by`); tablo biliniyorsa aynı tablo olmalı. Yazan sekme mutasyonun revalidatePath
 * yanıtıyla zaten tazelendi. Aynı kullanıcının İKİNCİ cihazı/sekmesi yazmadığı için olayı her zaman işler (odak,
 * created_by gibi kullanıcı bazlı kurallar KALDIRILDI).
 */
export function shouldIgnoreEcho(
  evt: Pick<TenantChange, "t" | "by">,
  selfUserId: string | null,
  local: LocalMutation | null,
  nowMs: number,
): boolean {
  if (!local || !selfUserId || !evt.by || evt.by !== selfUserId) return false;
  if (nowMs - local.at > REALTIME_ECHO_WINDOW_MS || nowMs < local.at) return false;
  return local.tables === "*" || local.tables.has(evt.t);
}

/** İlk katılımda tek tazeleme gerekir mi? (sayfa verisi açılış penceresinden eski) */
export function needsOpenWindowRefresh(nowMs: number, pageDataAtMs: number): boolean {
  return nowMs - pageDataAtMs > REALTIME_OPEN_WINDOW_MS;
}

/** Abonelik hatasında yeniden deneme beklemesi: 1, 2, 4, 8, 16, 30 sn (+ en çok 250 ms titreşim). */
export function realtimeBackoffMs(attempt: number, jitter: number = 0): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, Math.min(attempt, 10)));
  return base + Math.max(0, Math.min(250, jitter));
}
