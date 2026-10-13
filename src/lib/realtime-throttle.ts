/**
 * Realtime yenileme için saf yardımcılar (hook'tan ayrı: test edilebilir).
 *
 * Sorun: ofisteki her açık oturum deals/commissions/portal_listings/customers
 * değişiminde router.refresh() yapıyordu; toplu işlem (içe aktarma, toplu
 * atama) N oturum x M olay = sorgu fırtınası üretiyordu.
 *
 * Çözüm: (1) abonelik ROTAYA iner: açık sayfanın tabloları (`tablesForPath`, kaynak `ROUTE_TABLES`) TEK
 * postgres_changes kanalında dinlenir, ilgisiz rotada kanal hiç açılmaz (Realtime sunucusu boşa satır
 * süzmez, istemci boşa olay işlemez); (2) iki yenileme arası en az REALTIME_MIN_INTERVAL_MS, (3) bekleyen
 * yenileme varken gelen olaylar BİRLEŞTİRİLİR (zamanlayıcı yeniden kurulmaz).
 */

export const REALTIME_MIN_INTERVAL_MS = 10_000;

/** Yayındaki (supabase_realtime publication) çekirdek tablolar. Hepsi `ROUTE_TABLES`'ta en az bir rotaya bağlıdır (test). */
export const REALTIME_ALL_TABLES = ["deals", "commissions", "portal_listings", "customers"] as const;

/**
 * Genişletilmiş tablolar (20261011000800 ile yayında). Rota kanalı tek olduğundan yeni bir tablo `ROUTE_TABLES`'a
 * ancak publication'a eklendikten SONRA yazılır (yayında olmayan tablo o rotanın kanalını sessiz bırakır).
 */
export const REALTIME_EXTENDED_TABLES = ["properties", "customer_demands", "appointments", "tasks", "listing_pool_entries", "cash_entries"] as const;

/** 20261012002300 (merkez tabloları) ve 20261012002500 (fsbo_leads) ile yayına eklenen tablolar. */
export const REALTIME_MORE_TABLES = ["offers", "rent_charges", "rent_payments", "property_keys", "fsbo_leads"] as const;

/** Rota öneki → o sayfada tazelenmesi anlamlı tablolar (realtime aboneliğinin TEK kaynağı). */
export const ROUTE_TABLES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/app/musteriler", ["customers"]],
  ["/app/komisyon", ["commissions"]],
  ["/app/anlasmalar", ["deals", "commissions"]],
  ["/app/portallar", ["portal_listings"]],
  ["/app/portfoyler/anahtarlar", ["property_keys", "properties"]],
  ["/app/portfoyler", ["portal_listings", "properties"]],
  ["/app/talepler", ["customer_demands"]],
  ["/app/eslestirme", ["customer_demands", "properties"]],
  ["/app/randevular", ["appointments"]],
  ["/app/gorevler", ["tasks"]],
  ["/app/ilan-havuzu", ["listing_pool_entries", "properties"]],
  ["/app/giderler", ["cash_entries"]],
  ["/app/kiralama", ["deals", "properties", "rent_charges", "rent_payments"]],
  ["/app/aidat", ["rent_charges", "rent_payments"]],
  ["/app/kira-artis", ["rent_charges", "properties"]],
  ["/app/teklifler", ["offers", "deals"]],
  ["/app/cuzdan", ["commissions"]],
  ["/app/portfoy-avi", ["fsbo_leads"]],
];

/** Ana pano (/app) tüm merkezlerin özetini gösterir: rota tablolarının birleşimi (sıra korunur, tekrarsız). */
const HOME_TABLES: readonly string[] = [...new Set(ROUTE_TABLES.flatMap(([, tables]) => tables))];

/** Açık rotada tazelenmesi anlamlı tablolar. Ana pano tümünü gösterir; bilinmeyen rota hiçbirini (kanal açılmaz). */
export function tablesForPath(pathname: string | null | undefined): readonly string[] {
  const p = (pathname ?? "").split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (p === "/app") return HOME_TABLES;
  for (const [prefix, tables] of ROUTE_TABLES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return tables;
  }
  return [];
}

/**
 * Bir olay geldiğinde yenilemeden önce beklenecek süre (ms).
 * Hiç yenileme yapılmadıysa yalnız debounce; yakın zamanda yapıldıysa
 * son yenilemeden itibaren minInterval dolana kadar bekler.
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

/**
 * Satırda "son yazan" bilgisini taşıyan kolonlar, olay türüne göre:
 * INSERT'te oluşturan/aktör kendi yankımızdır; UPDATE'te YALNIZ `updated_by` (created_by başkasının güncellemesini
 * gizlemesin). DELETE'te ya da tür bilinmiyorsa aktör kuralı uygulanmaz.
 */
const ACTOR_COLUMNS_BY_EVENT: Record<string, readonly string[]> = {
  INSERT: ["created_by", "updated_by", "actor_id"],
  UPDATE: ["updated_by"],
};

/**
 * Olay yok sayılmalı mı?
 * (1) Kendi mutasyonumuzun yankısı: satırı son yazan benim; server action zaten revalidatePath yaptı.
 * (2) Değişiklik, son yenilememizden ÖNCE commit edildiyse o yenileme zaten içerir.
 */
export function shouldIgnoreRealtimeEvent(
  payload: { new?: Record<string, unknown> | null; commit_timestamp?: string | null; eventType?: string },
  selfUserId: string | null,
  lastRefreshAtMs: number | null,
): boolean {
  const row = payload.new ?? null;
  const actorCols = (payload.eventType && ACTOR_COLUMNS_BY_EVENT[payload.eventType]) || [];
  if (selfUserId && row) {
    for (const col of actorCols) {
      if (row[col] === selfUserId) return true;
    }
  }
  if (lastRefreshAtMs !== null && payload.commit_timestamp) {
    const t = Date.parse(payload.commit_timestamp);
    if (Number.isFinite(t) && t <= lastRefreshAtMs) return true;
  }
  return false;
}
