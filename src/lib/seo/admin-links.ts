/**
 * SEO MERKEZİ ADRESLERİ (SAF, tek kaynak). Sekmeler `?sekme=`, sekme içi bölümler `?bolum=` ile seçilir.
 * Yeni bağlantı yazan her yer (bulgu `href`, bildirim, öneri, başka ekrandaki "SEO'da aç") bu yardımcıyı kullanır.
 */

export const SEO_BASE = "/admin/site/seo";

export const SEO_TAB_IDS = ["genel", "sayfalar", "oneriler", "kelimeler", "programatik", "tarama", "geo", "ayarlar"] as const;
export type SeoTabId = (typeof SEO_TAB_IDS)[number];

/** Sekme içi bölümler (ilk öğe varsayılandır ve adreste yazılmaz). */
export const SEO_SECTIONS = {
  sayfalar: ["statik", "taranan", "vitrin", "kaliplar"],
  kelimeler: ["analiz", "performans"],
  tarama: ["robot", "sitemap", "yonlendirme", "veri"],
  ayarlar: ["genel", "gecmis", "yedek"],
} as const satisfies Partial<Record<SeoTabId, readonly string[]>>;

export type SeoSection<T extends SeoTabId> = T extends keyof typeof SEO_SECTIONS ? (typeof SEO_SECTIONS)[T][number] : never;

export function seoHref<T extends SeoTabId>(tab: T, bolum?: SeoSection<T>, params: Record<string, string | undefined> = {}, hash?: string): string {
  const q = new URLSearchParams();
  if (tab !== "genel") q.set("sekme", tab);
  const sections = (SEO_SECTIONS as Record<string, readonly string[]>)[tab];
  if (bolum && sections && bolum !== sections[0]) q.set("bolum", bolum);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, v);
  const qs = q.toString();
  return `${SEO_BASE}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}

/** Yönetilebilir (registry) sayfanın SEO kaydı editörü. */
export const seoPageEditorHref = (path: string) => seoHref("sayfalar", "statik", { sayfa: path }, "editor");

export function parseSeoTab(raw: string | undefined): SeoTabId {
  return (SEO_TAB_IDS as readonly string[]).includes(raw ?? "") ? (raw as SeoTabId) : "genel";
}

export function parseSeoSection<T extends keyof typeof SEO_SECTIONS>(tab: T, raw: string | undefined): (typeof SEO_SECTIONS)[T][number] {
  const list = SEO_SECTIONS[tab] as readonly string[];
  return (list.includes(raw ?? "") ? raw : list[0]) as (typeof SEO_SECTIONS)[T][number];
}
