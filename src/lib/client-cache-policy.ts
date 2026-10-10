/**
 * İstemci router önbelleği politikası (SAF; React/Next içermez, birim testlidir).
 *
 * Mimari (HIZ ANA İLKESİ): staleTimes.dynamic=300 → tıklamada sayfa önbellekten ANINDA açılır; güncel veri
 * arkadan gelir (stale-while-revalidate). Güvenlik: proxy kapısı her SUNUCU isteğinde önbelleksiz çalışır;
 * önbellek yalnız aynı oturumun zaten yetkili olduğu sayfayı en çok 300 sn gösterir ve arka plan tazelemesi
 * kapıdan reddedilirse (askı / giriş / 2FA) tam sayfa yönlendirmesi yapılır (bellek önbelleği sıfırlanır).
 */

/**
 * Önbellekten gösterilen sayfa bu süreden eskiyse arkadan tazelenir. 5 sn DENENDİ ve REDDEDİLDİ: router.refresh() TÜM
 * segment önbelleğini düşürür; her tıklamada tazeleme komşu sayfaları da düşürüp sonraki tıklamayı ağa çıkarıyordu
 * (ölçüm). 20 sn: sık gezinmede anında, durup beklenen sayfada tazeleme; dış değişiklikleri realtime, kendi
 * değişikliklerini mutasyon revalidate eder.
 */
export const REVALIDATE_AFTER_MS = 20_000;
/** İki arka plan tazelemesi arası en az süre (tazeleme TÜM segment önbelleğini geçersiz kılar). */
export const BG_REFRESH_MIN_GAP_MS = 15_000;
/** Arka plan tazelemesinden sonra kapı yönlendirmesi sayılan pencere. */
export const GATE_REDIRECT_WINDOW_MS = 15_000;
/** Aynı adres bu süre içinde yeniden önceden yüklenmez. */
export const PREFETCH_MIN_REPEAT_MS = 30_000;
/** Aynı anda en çok bu kadar önceden yükleme isteği (sırayla, aralıklı). */
export const PREFETCH_CONCURRENCY = 2;
export const PREFETCH_SLOT_MS = 700;
/** Önbellek düştükten sonra toplu yeniden ısıtma: gecikme ve iki ısıtma arası en az süre. */
export const REWARM_DELAY_MS = 1_500;
export const REWARM_MIN_GAP_MS = 10_000;
/** Liste satırlarında görünür alanda tam önceden yüklenen ilk detay bağlantısı sayısı. */
export const VIEWPORT_PREFETCH_BUDGET = 5;

export type ArrivalDecision = "mark" | "fresh" | "refresh";

/**
 * Bir adrese gelince ne yapılır?
 * - mark: adres bu oturumda ilk kez (canlı çekildi varsayılır) → yalnız zaman damgası konur.
 * - fresh: önbellek verisi yeni (≤ REVALIDATE_AFTER_MS) → dokunma.
 * - refresh: önbellekten gösterildi ve eski → sessiz arka plan tazelemesi.
 */
export function decideArrival(input: {
  fetchedAt: number | undefined;
  nowMs: number;
  lastBgRefreshAt: number | null;
  hidden: boolean;
}): ArrivalDecision {
  const { fetchedAt, nowMs, lastBgRefreshAt, hidden } = input;
  if (fetchedAt === undefined) return "mark";
  if (nowMs - fetchedAt <= REVALIDATE_AFTER_MS) return "fresh";
  if (hidden) return "fresh";
  if (lastBgRefreshAt !== null && nowMs - lastBgRefreshAt < BG_REFRESH_MIN_GAP_MS) return "fresh";
  return "refresh";
}

/** Proxy kapısının yönlendirdiği adresler: arka plan tazelemesi buraya düştüyse sayfa TAM yüklenir. */
export function isGatePath(pathname: string): boolean {
  return (
    pathname === "/giris" ||
    pathname.startsWith("/giris/") ||
    pathname === "/kayit" ||
    pathname === "/app/askida" ||
    pathname.startsWith("/app/askida/")
  );
}

export function isGateRedirectAfterRefresh(pathname: string, lastBgRefreshAt: number | null, nowMs: number): boolean {
  return lastBgRefreshAt !== null && nowMs - lastBgRefreshAt < GATE_REDIRECT_WINDOW_MS && isGatePath(pathname);
}

type NetworkInfo = { saveData?: boolean; effectiveType?: string };

/** Veri tasarrufu açık ya da yavaş (2g/3g) bağlantıda önceden yükleme yapılmaz. */
export function networkAllowsPrefetch(conn: NetworkInfo | null | undefined): boolean {
  if (!conn) return true;
  if (conn.saveData) return false;
  return !/^(slow-)?(2g|3g)$/.test(conn.effectiveType ?? "");
}
