/**
 * Public base URL — SEO (robots/sitemap/metadataBase) ve token'lı public link
 * üretimi için tek kaynak.
 *
 * NEDEN: `NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"` fallback'i PROD'da
 * tehlikeli — env unutulursa arama motoruna ve paylaşım linklerine localhost
 * URL'leri sızar. Bu çözümleyici Vercel'in kararlı prod alan adını ve bilinen
 * prod fallback'ini kullanır; localhost'a YALNIZ gerçek geliştirmede düşer.
 */

const PROD_FALLBACK = "https://emlaksoft.vercel.app";

export function getBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  // Vercel'in KARARLI prod alan adı (deployment-spesifik VERCEL_URL değil).
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  // Prod'da localhost'a ASLA düşme — bilinen alan adına düş.
  if (process.env.NODE_ENV === "production") return PROD_FALLBACK;

  return "http://localhost:3000";
}
