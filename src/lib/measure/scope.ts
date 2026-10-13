import { RESERVED_ROUTE_DIRS, SLUG_MAX, SLUG_RE } from "@/lib/site-pages/slug";

/**
 * Ölçüm kapsamı (SAF): hangi yol sayılabilir, sayılan yol hangi şablona indirgenir.
 *
 * S0 dikişi: `canMeasure` / `pathTemplate` tek kaynağı S0'ın `src/lib/seo/scope.ts` dosyasıdır; o dosya main'e
 * girdiğinde bu modül yalnız onu yeniden dışa verir (imzalar aynı tutuldu). O zamana dek kural burada yaşar.
 *
 * İlke: İZİN LİSTESİ. Yalnız herkese açık pazarlama yüzeyleri sayılır (ana sayfa, fiyatlar, kayıt girişi, araçlar,
 * yasal sayfalar, vitrin ve danışman kartı, sayfa oluşturucu sayfaları). Oturumlu alanlar (/app, /admin), giriş ve
 * şifre akışları, /kayit/tamamla, token'lı portallar ve yönlendirme uçları HİÇBİR ZAMAN sayılmaz.
 * Kişiye/ofise özgü parçalar (vitrin slug'ı, ilan kimliği, danışman slug'ı) şablona çevrilir; sorgu dizesi atılır.
 */

/** Sabit (tam eşleşen) herkese açık yollar. */
const EXACT = new Set([
  "/",
  "/fiyatlar",
  "/kayit",
  "/araclar",
  "/gizlilik",
  "/kvkk-aydinlatma",
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

function isPrivate(p: string): boolean {
  return NEVER_MEASURED_PREFIXES.some((pre) => (pre.endsWith("/") ? p.startsWith(pre) : p === pre || p.startsWith(`${pre}/`)));
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
 *   sayfa oluşturucu yolu     → aynen (yayınlanan sayfa adresi gizli değildir)
 */
export function pathTemplate(raw: string | null | undefined): string | null {
  const p = normalizeMeasurePath(raw);
  if (!p) return null;
  if (EXACT.has(p)) return p;
  if (isPrivate(p)) return null;
  const segs = p.slice(1).split("/");
  if (segs.some((s) => !SEG.test(s) || TOKENISH.test(s))) return null;
  const [first, second, third] = segs;
  if (first === "araclar") return segs.length === 2 ? p : null;
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
