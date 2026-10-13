/**
 * Vitrin KALICI noindex kuralı (SAF — sunucu ve test ortak).
 *
 * Örnek veri yüklü (sample_seeded_at dolu, sample_cleared_at boş), demo/test ve platform kiracıları ofisin arama
 * onayı (tenants.vitrin_seo_optin) yanlışlıkla açılsa bile arama motoruna AÇILMAZ. Kural `vitrinRobots(seoOptin)`
 * öncesinde uygulanır: vitrin, ilan detayı ve danışman sayfası noindex alır; sitemap'e de girmez.
 *
 * Liste: platform_settings `seo.vitrin.never_index` (JSON dizi ya da virgül/satır ayrımlı slug listesi). Varsayılan
 * slug'lar HER ZAMAN listededir (ayar yalnız ekler): okuma hatası, bozuk değer ya da boş liste korumayı kaldıramaz.
 */

export const VITRIN_NEVER_INDEX_KEY = "seo.vitrin.never_index";

export const DEFAULT_NEVER_INDEX_SLUGS: readonly string[] = ["demo-ofis", "e2e-test", "admin"];

/** Platform/demo/test türü (ileride `tenants.kind` gelirse); bilinmeyen tür kuralı etkilemez. */
const NEVER_INDEX_KINDS = new Set(["platform", "demo", "test", "sample"]);

export type NeverIndexTenant = {
  slug: string | null | undefined;
  sample_seeded_at?: string | null;
  sample_cleared_at?: string | null;
  kind?: string | null;
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function normalizeSlug(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return SLUG_RE.test(s) ? s : null;
}

/**
 * Ayar değerini çözümler. JSON dizi (`["a","b"]`) ya da düz metin (`a, b` / satır satır) kabul edilir; geçersiz
 * öğeler atılır. Sonuç: varsayılanlar + ayardaki geçerli slug'lar (tekrarsız). `raw` null (kayıt yok/okunamadı) ise
 * yalnız varsayılan.
 */
export function resolveNeverIndexList(raw: string | null | undefined): string[] {
  const out = new Set<string>(DEFAULT_NEVER_INDEX_SLUGS);
  const text = (raw ?? "").trim();
  if (!text) return [...out];
  let items: unknown[] = [];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  } else {
    items = text.split(/[\s,;]+/);
  }
  for (const it of items) {
    const s = normalizeSlug(it);
    if (s) out.add(s);
  }
  return [...out];
}

/** Örnek veri hâlâ yüklü mü (yüklenmiş ve temizlenmemiş)? */
export function isSampleTenant(t: Pick<NeverIndexTenant, "sample_seeded_at" | "sample_cleared_at">): boolean {
  return Boolean(t.sample_seeded_at) && !t.sample_cleared_at;
}

/** Bu kiracının vitrini opt-in'den bağımsız olarak HER ZAMAN noindex mi? */
export function isNeverIndexTenant(t: NeverIndexTenant, list: readonly string[]): boolean {
  if (isSampleTenant(t)) return true;
  if (t.kind && NEVER_INDEX_KINDS.has(t.kind.trim().toLowerCase())) return true;
  const slug = normalizeSlug(t.slug);
  if (!slug) return false;
  // Liste ne olursa olsun varsayılanlar geçerli (çağıran ham ayar dizisi geçse bile).
  return DEFAULT_NEVER_INDEX_SLUGS.includes(slug) || list.some((s) => normalizeSlug(s) === slug);
}

/** Arama motoru izni: ofis onayı VAR ve kiracı kalıcı noindex listesinde DEĞİL. */
export function vitrinIndexable(optin: boolean, t: NeverIndexTenant, list: readonly string[]): boolean {
  return optin === true && !isNeverIndexTenant(t, list);
}
