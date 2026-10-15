/**
 * İstemci router önbelleği politikası (SAF; React/Next içermez, birim testlidir).
 *
 * Mimari (HIZ ANA İLKESİ): staleTimes.dynamic=300 → tıklamada sayfa önbellekten ANINDA açılır; güncel veri
 * arkadan gelir (stale-while-revalidate). Güvenlik: proxy kapısı her SUNUCU isteğinde önbelleksiz çalışır;
 * önbellek yalnız aynı oturumun zaten yetkili olduğu sayfayı en çok 300 sn gösterir ve arka plan tazelemesi
 * kapıdan reddedilirse (askı / giriş / 2FA) tam sayfa yönlendirmesi yapılır (bellek önbelleği sıfırlanır).
 */

/**
 * Önbellekten gösterilen sayfa bu süreden eskiyse arkadan tazelenir (belge: CLAUDE.md "HIZ ANA İLKESİ" >20 sn; sabit ile
 * belge EŞİT, client-cache-policy.test.ts kilitler). 5 sn DENENDİ ve REDDEDİLDİ: router.refresh() TÜM segment önbelleğini
 * düşürür; her tıklamada tazeleme komşu sayfaları da düşürüp sonraki tıklamayı ağa çıkarıyordu (ölçüm). 20 sn: sık
 * gezinmede anında, durup beklenen sayfada tazeleme; dış değişiklikleri realtime (açık sayfa) ve olay geçersizlemesi
 * (kapalı rota, `invalidatedAt`), kendi değişikliklerini mutasyon revalidate eder.
 */
export const REVALIDATE_AFTER_MS = 20_000;
/** İki arka plan tazelemesi arası en az süre (tazeleme TÜM segment önbelleğini geçersiz kılar). */
export const BG_REFRESH_MIN_GAP_MS = 15_000;
/**
 * İŞ KUYRUĞU rotaları (B010): onay listesi, destek talepleri, yönetim panosu. Bekleyen iş eski görünmemeli (saha:
 * Onaylar önbellekten 287 ms'de açıldı, yeni talep 70 sn görünmedi): önbellekten gösterilen sayfa 3 sn'den eskiyse ve
 * oturumdaki ilk açılışı da (önceden yüklenmiş olabilir) arkadan tazelenir.
 */
export const WORK_QUEUE_REVALIDATE_AFTER_MS = 3_000;
export const WORK_QUEUE_BG_REFRESH_MIN_GAP_MS = 3_000;
/** Tam eşleşen (`exact`) ya da önek (alt sayfalar dahil) iş kuyruğu rotaları. */
export const WORK_QUEUE_ROUTES: ReadonlyArray<{ path: string; exact?: boolean }> = [
  { path: "/app/onaylar" },
  { path: "/app/destek" },
  { path: "/admin", exact: true },
  { path: "/admin/tickets" },
];

export function isWorkQueuePath(pathname: string): boolean {
  const p = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return WORK_QUEUE_ROUTES.some((r) => p === r.path || (!r.exact && p.startsWith(`${r.path}/`)));
}
/** Arka plan tazelemesinden sonra kapı yönlendirmesi sayılan pencere. */
export const GATE_REDIRECT_WINDOW_MS = 15_000;
/** Aynı adres bu süre içinde yeniden önceden yüklenmez. */
export const PREFETCH_MIN_REPEAT_MS = 120_000;
/** Aynı anda en çok bu kadar önceden yükleme isteği (sırayla, aralıklı). */
export const PREFETCH_CONCURRENCY = 2;
export const PREFETCH_SLOT_MS = 700;
/** Önbellek düştükten sonra toplu yeniden ısıtma: gecikme ve iki ısıtma arası en az süre. */
export const REWARM_DELAY_MS = 1_500;
export const REWARM_MIN_GAP_MS = 10_000;
/** Liste satırlarında görünür alanda tam önceden yüklenen ilk detay bağlantısı sayısı. */
export const VIEWPORT_PREFETCH_BUDGET = 4;

export type ArrivalDecision = "mark" | "fresh" | "refresh";

/**
 * Bir adrese gelince ne yapılır?
 * - mark: adres bu oturumda ilk kez ve sayfa yeni yüklendi (canlı çekildi) → yalnız zaman damgası konur.
 * - fresh: önbellek verisi yeni (≤ eşik) ve sonradan geçersizlenmedi → dokunma.
 * - refresh: önbellekten gösterildi ve eski / realtime olayıyla geçersizlendi / iş kuyruğunun oturumdaki ilk açılışı
 *   (önceden yüklenmiş olabilir) → sessiz arka plan tazelemesi.
 */
export function decideArrival(input: {
  fetchedAt: number | undefined;
  nowMs: number;
  lastBgRefreshAt: number | null;
  hidden: boolean;
  /** İş kuyruğu rotası mı (`isWorkQueuePath`). */
  workQueue?: boolean;
  /** Bu rotanın verisini değiştiren son realtime olayı / bildirim (client-cache-state `getInvalidatedAt`). */
  invalidatedAt?: number;
  /** Sayfa yüklemesinden sonraki ilk varış (veri canlı çekildi; önceden yükleme olamaz). */
  firstArrival?: boolean;
}): ArrivalDecision {
  const { fetchedAt, nowMs, lastBgRefreshAt, hidden, workQueue = false, invalidatedAt, firstArrival = false } = input;
  if (firstArrival) return "mark";
  const invalidated = invalidatedAt !== undefined && (fetchedAt === undefined || invalidatedAt > fetchedAt);
  if (fetchedAt === undefined && !invalidated && !workQueue) return "mark";
  const maxAge = workQueue ? WORK_QUEUE_REVALIDATE_AFTER_MS : REVALIDATE_AFTER_MS;
  if (!invalidated && fetchedAt !== undefined && nowMs - fetchedAt <= maxAge) return "fresh";
  if (hidden) return "fresh";
  const gap = workQueue || invalidated ? WORK_QUEUE_BG_REFRESH_MIN_GAP_MS : BG_REFRESH_MIN_GAP_MS;
  if (lastBgRefreshAt !== null && nowMs - lastBgRefreshAt < gap) return "fresh";
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

/** Boşta tam önceden yükleme oturum başına en çok bu kadar adres (= rolün menü merkezleri, ≤10). 2026-10-11 tıkanmasında 4 idi; Supabase işlem gücü yükseltildi (2026-10-12), eşzamanlılık 2 + 700 ms aralık + toplu yeniden ısıtma YOK korunur. */
export const IDLE_PREFETCH_SESSION_CAP = 10;
