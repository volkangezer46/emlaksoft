import { NEVER_INDEX_PREFIXES, seoPages } from "./registry";

/**
 * SEO/BÜYÜME KAPSAM SÖZLEŞMESİ (SAF). Hangi yol otomatik iyileştirilebilir, hangisi yalnız elle, hangisi kapsam dışı.
 *
 * S0 ÖN SÜRÜMÜ: bu dosya SP2 tarafından S0 paketi main'e gelmeden önce yazıldı (SP2'nin ön koşulu). S0 kendi sürümünü
 * getirirse aynı işlev adları korunarak birleştirilir; SP2 yalnız aşağıdaki dışa açık işlevleri kullanır.
 *
 *  - Kapsam DIŞI (hiç taranmaz, hiç öneri almaz): /app, /admin, /api, /giris, /kayit/tamamla, /sifre-*, /auth, token'lı
 *    portallar (registry.ts NEVER_INDEX_PREFIXES).
 *  - Üyelik/oturum yolları (`isMemberPath`): /kayit ve /kayit/* . Public ve indekslenebilir olabilir ama bulguları
 *    `manualOnly`: otomatik taslak (seo_meta_draft) ve AI önerisi ALMAZ.
 *  - Ofis içeriği (/vitrin, /danisman): ofisin kendi verisidir; platform otomatik değiştirmez (manualOnly).
 *  - `canAutoOptimize`: geri kalan herkese açık pazarlama sayfaları (registry + sayfa oluşturucu yolları).
 */

/** Üyelik ve oturum akışı yolları (kapsam dışı olanlar dahil). */
const MEMBER_PREFIXES = ["/kayit", "/giris", "/sifre-yenile", "/sifre-sifirla", "/auth", "/app", "/admin"] as const;

/** Ofis (kiracı) içerikli public yüzeyler: platform otomatik iyileştirmez. */
const TENANT_PREFIXES = ["/vitrin", "/danisman"] as const;

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

/** Parmak izi için adres: küçük harf host, sorgu ve parça yok, sondaki "/" yok. */
export function normalizeUrlForFingerprint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.toLowerCase()}${normalizePath(u.pathname)}`;
  } catch {
    return normalizePath(url);
  }
}

/** Taranmayan, öneri almayan yollar (token'lı portallar, oturumlu alanlar, OAuth ara adımları). */
export function isOutOfScope(path: string): boolean {
  const p = normalizePath(path);
  if (NEVER_INDEX_PREFIXES.some((x) => under(p, x))) return true;
  return p.includes("/favoriler");
}

/** Üyelik/oturum akışı (kapsam dışı olanlar ve /kayit dahil). */
export function isMemberPath(path: string): boolean {
  const p = normalizePath(path);
  return MEMBER_PREFIXES.some((x) => under(p, x));
}

/** Herkese açık ve taranabilir yüzey (kapsam içi). /kayit kapsam içidir ama otomatik iyileştirilmez. */
export function isPublicScope(path: string): boolean {
  return !isOutOfScope(path);
}

/**
 * Platform bu sayfayı OTOMATİK iyileştirebilir mi (taslak, AI önerisi, IndexNow olay bildirimi, llms.txt)?
 * Yalnız kapsam içi, üyelik/oturum dışı ve ofis içeriği olmayan yollar.
 */
export function canAutoOptimize(path: string): boolean {
  const p = normalizePath(path);
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
