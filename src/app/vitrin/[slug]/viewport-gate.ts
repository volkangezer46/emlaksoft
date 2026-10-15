/**
 * Vitrin istemci adası kapısı (SAF, DOM'a yalnız verilen elemanla ve belge düzeyi niyet dinleyicisiyle dokunur). Kapı
 * modül düzeyinde TEK; gözlem ise ÖRNEK BAŞINA: her bağlanan ada kendi işaret elemanını `watch` ile gözler, herhangi
 * biri görünür alana 600 px yaklaşınca kapı açılır ve bir daha kapanmaz. İstemci gezinmesinde (vitrin → ilan detayı,
 * filtre sekmesi) eski eleman sökülür (`watch` dönüşüyle gözlem biter), yeni sayfanın elemanı yeniden gözlenir;
 * bekleyen React.lazy yükü böylece askıda kalmaz.
 *
 * NİYET TETİKLEYİCİSİ (SK8 B146): kaydırmadan çip ("Satılık", tür, "Filtreleri temizle") tıklaması aynı rotada
 * searchParams değiştirir; Next geçişi startTransition içinde yapar ve RSC yükü sayfanın altındaki (hidrasyonu
 * bekleyen) adalara yeni prop verir. React 19.2 böyle bir sınırı önce hidrate etmeye çalışır; lazy kapıda askıda
 * kaldığı için geçişin commit'i kapı açılana (kullanıcı aşağı kaydırana) dek ertelenir — URL 15 sn+ değişmez. Bu
 * yüzden belgedeki İLK pointerdown / touchstart / keydown / focusin (capture + passive + once) TÜM kapıları açar:
 * tıklama daha bitmeden lazy çözülür, geçiş yalnız hidrasyon süresi (birkaç ms) bekler.
 */
export type ViewportGate = {
  /** Kapı açılınca çözülür (sunucuda hemen çözülmüş gelir). */
  released: Promise<void>;
  /** Elemanı gözle; dönen işlev gözlemi bırakır (useEffect temizliği). */
  watch: (el: Element | null) => () => void;
};

export const ISLAND_ROOT_MARGIN = "600px 0px";

/** Kullanıcı niyeti sayılan ilk olaylar (capture fazında, pasif, tek sefer). */
export const INTENT_EVENTS = ["pointerdown", "touchstart", "keydown", "focusin"] as const;

const pendingReleases = new Set<() => void>();
let intentSeen = false;
let intentArmed = false;

function onIntent() {
  intentSeen = true;
  disarmIntent();
  const releases = [...pendingReleases];
  pendingReleases.clear();
  for (const release of releases) release();
}

function armIntent() {
  if (intentArmed || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  intentArmed = true;
  for (const type of INTENT_EVENTS) {
    document.addEventListener(type, onIntent, { capture: true, passive: true, once: true });
  }
}

function disarmIntent() {
  if (!intentArmed) return;
  intentArmed = false;
  if (typeof document === "undefined" || typeof document.removeEventListener !== "function") return;
  for (const type of INTENT_EVENTS) document.removeEventListener(type, onIntent, { capture: true });
}

/** Test yardımcısı: modül düzeyi niyet durumunu sıfırlar. */
export function __resetViewportIntentForTests() {
  disarmIntent();
  pendingReleases.clear();
  intentSeen = false;
}

export function createViewportGate(): ViewportGate {
  let open = typeof window === "undefined" || intentSeen;
  let release: () => void = () => {};
  const released = open
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        release = () => {
          if (open) return;
          open = true;
          pendingReleases.delete(release);
          resolve();
        };
      });
  if (!open) {
    pendingReleases.add(release);
    armIntent();
  }
  const noop = () => {};
  return {
    released,
    watch(el) {
      if (open) return noop;
      // Eleman yoksa ya da IntersectionObserver yoksa beklemeden aç (eski tarayıcı; ada asla boş kalmaz).
      if (!el || typeof IntersectionObserver === "undefined") {
        release();
        return noop;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            release();
          }
        },
        { rootMargin: ISLAND_ROOT_MARGIN },
      );
      io.observe(el);
      return () => io.disconnect();
    },
  };
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

/**
 * Sayfa `load` olayından SONRA, tarayıcı boşta kaldığında `cb` çalışır (requestIdleCallback; yoksa `fallbackMs`
 * sonra). Ada parçalarını kapı beklemeden ISITMAK için: kullanıcı tıkladığında kapı açılır ve lazy aynı mikro görevde
 * çözülür (ağ beklemez). LCP'ye ve ilk etkileşime yük bindirmez. Sunucuda hiçbir şey yapmaz.
 */
export function whenIdleAfterLoad(cb: () => void, fallbackMs = 2500): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const w = window as IdleWindow;
  const schedule = () => {
    if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(cb, { timeout: 3000 });
    else setTimeout(cb, fallbackMs);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}

const isElement = (v: unknown) => typeof v === "object" && v !== null && "$$typeof" in v;
const isPlainData = (v: unknown) =>
  Array.isArray(v) || (typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype);

/**
 * Ada `memo` karşılaştırıcısı (SK8 B146): RSC yükü aynı veriyi yeni nesne olarak verse de değer eşitse ada yeniden
 * çizilmez (hidrasyonu bekleyen sınıra güncelleme gitmez). Eşitlik: ilkel/aynı referans ya da (React öğesi olmayan)
 * düz veri JSON olarak eşit; işlev ve React öğesi (children) yalnız referansla.
 */
export function sameIslandProps(a: object, b: object): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (Object.is(va, vb)) continue;
    if (isElement(va) || isElement(vb) || !isPlainData(va) || !isPlainData(vb)) return false;
    if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
  }
  return true;
}
