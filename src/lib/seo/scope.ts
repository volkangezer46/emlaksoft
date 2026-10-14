import { RESERVED_ROUTE_DIRS, SLUG_MAX, SLUG_RE } from "@/lib/site-pages/slug";
import { NEVER_INDEX_PREFIXES, seoPages } from "./registry";

/**
 * SEO/BÜYÜME KAPSAM SÖZLEŞMESİ (SAF) — S0, TEK KAYNAK. Hangi yol otomatik iyileştirilebilir, hangisi yalnız elle,
 * hangisi kapsam dışı, hangisi ölçülür. Diğer kopyalar buraya bağlanır (davranışları sözleşme testleriyle kilitli):
 *  - `site-issues/fingerprint.ts` parmak izi ve kapsam işlevlerini buradan YENİDEN DIŞA VERİR;
 *  - `measure/scope.ts` ölçüm kapsamını (`canMeasure`, `pathTemplate`) buradan yeniden dışa verir;
 *  - `google/collector.ts` Search Console önerisi için `canAutoOptimize`'ı çağırır;
 *  - `static-home/registry.ts` proxy'de çalıştığı için (hafif paket) kendi önek listesini tutar; sözleşme testi
 *    (`static-home/registry.test.ts`) her statik yolun `canAutoOptimize` olduğunu ve üyelik öneklerinin listede
 *    bulunduğunu doğrular.
 *
 *  - Kapsam DIŞI (hiç taranmaz, hiç öneri almaz): /app, /admin, /api, /giris, /kayit/tamamla, /sifre-*, /auth, token'lı
 *    portallar (registry.ts NEVER_INDEX_PREFIXES).
 *  - Üyelik/oturum yolları (`isMemberPath`): /kayit ve /kayit/* . Public ve indekslenebilir olabilir ama bulguları
 *    `manualOnly`: otomatik taslak (seo_meta_draft) ve AI önerisi ALMAZ.
 *  - Ofis içeriği (/vitrin, /danisman): ofisin kendi verisidir; platform otomatik değiştirmez (manualOnly).
 *  - `canAutoOptimize`: geri kalan herkese açık pazarlama sayfaları (registry + sayfa oluşturucu yolları).
 */

/** Üyelik ve oturum akışı yolları (kapsam dışı olanlar dahil). */
export const MEMBER_PREFIXES = ["/kayit", "/giris", "/sifre-yenile", "/sifre-sifirla", "/auth", "/app", "/admin"] as const;

/** Ofis (kiracı) içerikli public yüzeyler: platform otomatik iyileştirmez. */
export const TENANT_PREFIXES = ["/vitrin", "/danisman"] as const;

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Yol normalleştirme: sorgu/parça atılır, sondaki "/" kaldırılır (kök "/" kalır). */
export function normalizePath(path: string): string {
  const p = path.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/** Mutlak adres ya da yoldan yalnız yol (geçersizse null). */
export function pathOfUrl(urlOrPath: string): string | null {
  if (urlOrPath.startsWith("/") && !urlOrPath.startsWith("//")) return normalizePath(urlOrPath);
  try {
    return normalizePath(new URL(urlOrPath).pathname || "/");
  } catch {
    return null;
  }
}

/** Parmak izinde saklanan yolun en çok uzunluğu (site_issues.url CHECK ile aynı). */
export const FINGERPRINT_URL_MAX = 300;

/**
 * Parmak izi için YALNIZ YOL: mutlak adres de verilse origin, sorgu ve parça atılır; sondaki "/" (kök hariç) ve
 * yinelenen "/" silinir; en çok 300 karakter. Kokpit kuyruğundaki (site_issues) parmak izleri bununla üretilir.
 */
export function normalizeUrlForFingerprint(raw: string): string {
  let path = String(raw ?? "").trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      path = "/";
    }
  }
  path = path.replace(/[?#].*$/, "");
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return (path || "/").slice(0, FINGERPRINT_URL_MAX);
}

/** Kapsam kararları yol ya da mutlak adres alır; ikisi de aynı yola indirgenir. */
const scopePath = (urlOrPath: string) => normalizeUrlForFingerprint(urlOrPath);

/** Taranmayan, öneri almayan yollar (token'lı portallar, oturumlu alanlar, OAuth ara adımları). */
export function isOutOfScope(path: string): boolean {
  const p = scopePath(path);
  if (NEVER_INDEX_PREFIXES.some((x) => under(p, x))) return true;
  return p.includes("/favoriler");
}

/** Üyelik/oturum akışı (kapsam dışı olanlar ve /kayit dahil). */
export function isMemberPath(path: string): boolean {
  const p = scopePath(path);
  return MEMBER_PREFIXES.some((x) => under(p, x));
}

/** Herkese açık ve taranabilir yüzey (kapsam içi). /kayit kapsam içidir ama otomatik iyileştirilmez. */
export function isPublicScope(path: string): boolean {
  return !isOutOfScope(path);
}

/**
 * Platform bu sayfayı OTOMATİK iyileştirebilir mi (taslak, AI önerisi, IndexNow olay bildirimi, llms.txt, statik sunum,
 * Otopilot)? Yalnız kapsam içi, üyelik/oturum dışı ve ofis içeriği olmayan yollar.
 */
export function canAutoOptimize(path: string): boolean {
  const p = scopePath(path);
  if (!isPublicScope(p) || isMemberPath(p)) return false;
  if (TENANT_PREFIXES.some((x) => under(p, x))) return false;
  return true;
}

/** Bulgu otomatik eylem alamaz (yalnız ekrana yönlendirme). */
export function isManualOnly(urlOrPath: string): boolean {
  const p = pathOfUrl(urlOrPath);
  return p === null || !canAutoOptimize(p);
}

/** Registry'deki, otomatik iyileştirilebilir ve varsayılanı indekslenebilir sayfalar (llms.txt, IndexNow izin listesi). */
export function autoOptimizeRegistryPaths(): string[] {
  return seoPages()
    .filter((p) => p.index && canAutoOptimize(p.path))
    .map((p) => p.path);
}

/* ---------------------------------------------------------------------------------------------------------------
 * ÖLÇÜM KAPSAMI (birinci taraf ziyaret sayacı; `measure/scope.ts` buradan yeniden dışa verir).
 *
 * İlke: İZİN LİSTESİ. Yalnız herkese açık pazarlama yüzeyleri sayılır (ana sayfa, fiyatlar, kayıt girişi, araçlar,
 * yasal sayfalar, rehber, vitrin ve danışman kartı, sayfa oluşturucu sayfaları). Oturumlu alanlar (/app, /admin), giriş
 * ve şifre akışları, /kayit/tamamla, token'lı portallar ve yönlendirme uçları HİÇBİR ZAMAN sayılmaz; SEO kapsamı dışı
 * (`isOutOfScope`) her yol da ölçülmez. Kişiye/ofise özgü parçalar (vitrin slug'ı, ilan kimliği, danışman slug'ı)
 * şablona çevrilir; sorgu dizesi atılır.
 * ------------------------------------------------------------------------------------------------------------- */

/** Sabit (tam eşleşen) herkese açık ölçülen yollar. */
const MEASURE_EXACT = new Set([
  "/",
  "/fiyatlar",
  "/kayit",
  "/araclar",
  "/gizlilik",
  "/kvkk-aydinlatma",
  "/kvkk-basvuru",
  "/kullanim-sartlari",
  "/cerez-politikasi",
  "/mesafeli-satis",
  "/on-bilgilendirme",
  "/iptal-iade",
  "/davet-kosullari",
]);

/** Asla sayılmayan ilk segmentler (izin listesi zaten dışarıda bırakır; bu liste niyeti açık eder ve testlenir). */
export const NEVER_MEASURED_PREFIXES = [
  "/app",
  "/admin",
  "/api",
  "/giris",
  "/kayit/",
  "/sifre-yenile",
  "/sifre-sifirla",
  "/auth",
  "/malik-portali",
  "/musteri-portali",
  "/lead",
  "/tavsiye",
  "/randevu-al",
  "/randevu-teyit",
  "/anket",
  "/imza",
  "/evrak",
  "/sunum",
  "/paylas",
  "/odeme-link",
  "/degerleme-raporu",
  "/acik-ev-kayit",
  "/onizleme",
  "/bakim",
  "/r/",
  "/p/",
] as const;

const SEG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Token benzeri uzun rastgele parça (paylaşım bağlantıları): sayılmaz. */
const TOKENISH = /^[A-Za-z0-9_-]{24,}$/;
const RESERVED_FIRST = new Set<string>(RESERVED_ROUTE_DIRS);

/** Yalnız yol kısmı: sorgu/parça atılır, sondaki "/" kırpılır (kök hariç). Geçersizse null. */
export function normalizeMeasurePath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.trim();
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  if (!p.startsWith("/") || p.startsWith("//") || p.length > 300) return null;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p || "/";
}

function isNeverMeasured(p: string): boolean {
  if (NEVER_MEASURED_PREFIXES.some((pre) => (pre.endsWith("/") ? p.startsWith(pre) : p === pre || p.startsWith(`${pre}/`)))) return true;
  // Tek kaynak: SEO kapsamı dışı her yol (oturum, token'lı portal, OAuth ara adımı, favoriler) ölçülmez.
  return isOutOfScope(p);
}

/** Bu yol ölçülebilir mi? (yalnız herkese açık yüzeyler; sorgu dizesi dikkate alınmaz) */
export function canMeasure(raw: string | null | undefined): boolean {
  return pathTemplate(raw) !== null;
}

/**
 * Ölçülebilir yolu saklanacak şablona çevirir (≤120 karakter); kapsam dışıysa null.
 *   /vitrin/<ofis>            → /vitrin/[ofis]
 *   /vitrin/<ofis>/<ilan>     → /vitrin/[ofis]/[ilan]
 *   /vitrin/<ofis>/degerleme  → /vitrin/[ofis]/degerleme   (favoriler kişiye özel: sayılmaz)
 *   /danisman/<kişi>          → /danisman/[kisi]
 *   /araclar/<araç>           → aynen (sabit araç listesi)
 *   /rehber, /rehber/<yazı>, /rehber/kategori/<kategori> → aynen (yayınlanan yazı adresi gizli değildir)
 *   sayfa oluşturucu yolu     → aynen (yayınlanan sayfa adresi gizli değildir)
 */
export function pathTemplate(raw: string | null | undefined): string | null {
  const p = normalizeMeasurePath(raw);
  if (!p) return null;
  if (MEASURE_EXACT.has(p)) return p;
  if (isNeverMeasured(p)) return null;
  const segs = p.slice(1).split("/");
  if (segs.some((s) => !SEG.test(s) || TOKENISH.test(s))) return null;
  const [first, second, third] = segs;
  if (first === "araclar") return segs.length === 2 ? p : null;
  if (first === "rehber") return segs.length <= 3 && p.length <= 120 ? p : null;
  if (first === "vitrin") {
    if (segs.length === 2) return "/vitrin/[ofis]";
    if (segs.length === 3 && third === "degerleme") return "/vitrin/[ofis]/degerleme";
    if (segs.length === 3 && third !== "favoriler") return "/vitrin/[ofis]/[ilan]";
    return null;
  }
  if (first === "danisman") return segs.length === 2 && second ? "/danisman/[kisi]" : null;
  // Sayfa oluşturucu (catch-all) yolları: slug kuralına uyan, ayrılmış ilk segmentle başlamayan en çok 3 segment.
  const slug = p.slice(1);
  if (slug.length <= SLUG_MAX && SLUG_RE.test(slug) && !RESERVED_FIRST.has(first!)) return p.length <= 120 ? p : null;
  return null;
}
