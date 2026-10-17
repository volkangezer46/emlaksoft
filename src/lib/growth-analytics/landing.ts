/**
 * İniş yolu tablosu (SAF): her yol şablonundan düzenleme ekranlarına bağlantı ("sıfır çıkmaz metrik").
 *  - İçerik: ana sayfa → Site içeriği, fiyatlar → Fiyatlar sayfası metinleri, sayfa oluşturucu yolu → o sayfanın
 *    editörü (yayın dizininden slug eşlemesiyle), diğerleri → Sayfalar listesi.
 *  - SEO kaydı: /admin/site/seo "Sayfalar" sekmesinde o yol (kayıt yoksa editör kayıt oluşturmayı önerir).
 * Şablon yollar (/vitrin/[ofis]...) tek bir sayfa değildir: içerik bağlantısı yoktur, SEO bağlantısı kalıp sekmesidir.
 */
import type { LandingRow } from "./funnel";

export type LandingLinks = { content: { href: string; label: string } | null; seo: { href: string; label: string } };

export type SitePageRef = { id: string; slug: string };

export function landingLinks(path: string, pages: readonly SitePageRef[]): LandingLinks {
  if (path.includes("[") || path === "(taşma)") {
    return { content: null, seo: { href: "/admin/site/seo?sekme=sayfalar&bolum=kaliplar", label: "SEO kalıbı" } };
  }
  const seo = { href: `/admin/site/seo?sekme=sayfalar&sayfa=${encodeURIComponent(path)}#editor`, label: "SEO kaydı" };
  if (path === "/") return { content: { href: "/admin/site/sayfalar/ana-sayfa", label: "Site içeriği" }, seo };
  if (path === "/fiyatlar") return { content: { href: "/admin/site/sayfalar/fiyatlar", label: "Sayfa metinleri" }, seo };
  const page = pages.find((p) => `/${p.slug}` === path);
  if (page) return { content: { href: `/admin/site/sayfalar/${encodeURIComponent(page.id)}`, label: "Sayfa editörü" }, seo };
  return { content: { href: "/admin/site/sayfalar", label: "Sayfalar" }, seo };
}

export type LandingView = LandingRow & { links: LandingLinks; signupRate: number | null };

/** Tablo satırları: ziyarete göre (yoksa kayda göre) sıralı, en çok `limit`. Kayıt oranı payda 0 iken null. */
export function landingTable(rows: readonly LandingRow[], pages: readonly SitePageRef[], limit = 30): LandingView[] {
  return [...rows]
    .sort((a, b) => (b.visits ?? -1) - (a.visits ?? -1) || b.signups - a.signups || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((r) => ({ ...r, links: landingLinks(r.path, pages), signupRate: r.visits && r.visits > 0 ? r.signups / r.visits : null }));
}
