/**
 * Realtime yenileme için saf yardımcılar (hook'tan ayrı: test edilebilir).
 *
 * Sorun: ofisteki her açık oturum deals/commissions/portal_listings/customers
 * değişiminde router.refresh() yapıyordu; toplu işlem (içe aktarma, toplu
 * atama) N oturum x M olay = sorgu fırtınası üretiyordu.
 *
 * Çözüm: (1) olay yalnız açık sayfayı ilgilendiren tablolardan geliyorsa dikkate
 * alınır, (2) iki yenileme arası en az REALTIME_MIN_INTERVAL_MS, (3) bekleyen
 * yenileme varken gelen olaylar BİRLEŞTİRİLİR (zamanlayıcı yeniden kurulmaz).
 */

export const REALTIME_MIN_INTERVAL_MS = 10_000;

/** Yayındaki (supabase_realtime publication) çekirdek tablolar: kanal aboneliği bu kümeye yapılır. */
export const REALTIME_ALL_TABLES = ["deals", "commissions", "portal_listings", "customers"] as const;

/**
 * Genişletilmiş tablolar AYRI kanalda dinlenir (publication'a eklenmemişse yalnız o kanal sessiz kalır, çekirdek
 * kanal etkilenmez). Etkinleştirmek için publication'a ekleyen migration gerekir (bkz. docs/HAFIZA.md §3 hız).
 */
export const REALTIME_EXTENDED_TABLES = ["properties", "customer_demands", "appointments", "tasks", "listing_pool_entries", "cash_entries"] as const;

/**
 * Üçüncü kanal: 20261012002300 (merkez tabloları) ve 20261012002500 (fsbo_leads) ile yayına eklenen tablolar (migration uygulanana kadar yalnız bu kanal sessiz kalır).
 */
export const REALTIME_MORE_TABLES = ["offers", "rent_charges", "rent_payments", "property_keys", "fsbo_leads"] as const;

const ROUTE_TABLES: ReadonlyArray<readonly [string, readonly string[]]> = [
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

/** Açık rotada tazelenmesi anlamlı tablolar. Ana pano tümünü gösterir; bilinmeyen rota hiçbirini. */
export function tablesForPath(pathname: string | null | undefined): readonly string[] {
  const p = (pathname ?? "").split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (p === "/app") return [...REALTIME_ALL_TABLES, ...REALTIME_EXTENDED_TABLES, ...REALTIME_MORE_TABLES];
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

/** Satırda "son yazan" bilgisini taşıyan olası kolonlar (varsa kendi yazımımız sayılır). */
const ACTOR_COLUMNS = ["updated_by", "created_by", "actor_id"] as const;

/**
 * Olay yok sayılmalı mı?
 * (1) Kendi mutasyonumuzun yankısı: satırı son yazan benim; server action zaten revalidatePath yaptı.
 * (2) Değişiklik, son yenilememizden ÖNCE commit edildiyse o yenileme zaten içerir.
 */
export function shouldIgnoreRealtimeEvent(
  payload: { new?: Record<string, unknown> | null; commit_timestamp?: string | null },
  selfUserId: string | null,
  lastRefreshAtMs: number | null,
): boolean {
  const row = payload.new ?? null;
  if (selfUserId && row) {
    for (const col of ACTOR_COLUMNS) {
      if (row[col] === selfUserId) return true;
    }
  }
  if (lastRefreshAtMs !== null && payload.commit_timestamp) {
    const t = Date.parse(payload.commit_timestamp);
    if (Number.isFinite(t) && t <= lastRefreshAtMs) return true;
  }
  return false;
}
