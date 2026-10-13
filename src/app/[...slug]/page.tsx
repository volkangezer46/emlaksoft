import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { headers } from "next/headers";
import { now } from "@/lib/clock";
import { getBaseUrl } from "@/lib/base-url";
import { PricingShell } from "@/components/pricing-page/page-shell";
import { faqLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { isProtectedFrom } from "@/lib/seo/redirects";
import { buildMetadata, getRedirectMap, getSeoSettings, logNotFound } from "@/lib/seo/store";
import { SitePageBlocks, contactInfoFrom } from "@/lib/site-pages/blocks";
import { sitePageExtraMetadata, sitePageFaq } from "@/lib/site-pages/metadata";
import { resolveCatchAll, type CatchAllDecision } from "@/lib/site-pages/resolve";
import { getLiveSitePage, getPublishedSlugMap } from "@/lib/site-pages/store";

/**
 * Hiçbir sayfayla eşleşmeyen yolların tek durağı (Next, daha özgül rotaları önce eşler; bu yalnız 404'e düşecek
 * yollarda çalışır — mevcut sayfaların performansına dokunmaz). Sıra (resolveCatchAll):
 *  1) /admin/seo "Yönlendirmeler" kuralı varsa 308/307 ile yönlendirir (DEĞİŞMEZ ve önceliklidir; sayfa akışından önce).
 *  2) Sayfa oluşturucuda (/admin/site/sayfalar) yayında bir sayfa bu yoldaysa onu çizer.
 *  3) Yoksa 404'ü sayaçla (yalnız yol; IP/sorgu yok) ve 404 sayfasını gösterir.
 * Yönlendirme haritası süreç içi önbellekli (60 sn); yayınlı sayfa haritası ve içerikleri etiketli önbellekten
 * (`site-pages`, 300 sn, yayında tazelenir). İstek başına veritabanı sorgusu YOKTUR.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string[] }> };

function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function decide(params: Props["params"]): Promise<{ path: string; decision: CatchAllDecision }> {
  const { slug } = await params;
  const path = `/${slug.map(decodeSeg).join("/")}`;
  const [map, slugMap] = await Promise.all([getRedirectMap(now()), getPublishedSlugMap().catch(() => ({}))]);
  return { path, decision: resolveCatchAll(path, map, slugMap) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { decision } = await decide(params);
  if (decision.kind !== "page") return {};
  const content = await getLiveSitePage(decision.id).catch(() => null);
  if (!content) return {};
  return buildMetadata(`/${decision.slug}`, sitePageExtraMetadata(getBaseUrl(), decision.slug, content));
}

export default async function UnmatchedPage({ params }: Props) {
  const { path, decision } = await decide(params);

  if (decision.kind === "redirect") {
    if (decision.status === 308) permanentRedirect(decision.to);
    redirect(decision.to);
  }

  if (decision.kind === "page") {
    const [content, seo] = await Promise.all([getLiveSitePage(decision.id).catch(() => null), getSeoSettings()]);
    if (content) {
      const faq = faqLd(sitePageFaq(content));
      return (
        <PricingShell measurePath={`/${decision.slug}`}>
          {faq ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({ "@context": "https://schema.org", "@graph": [faq] }) }} /> : null}
          <SitePageBlocks content={content} contact={contactInfoFrom(seo.global)} />
        </PricingShell>
      );
    }
  }

  if (!isProtectedFrom(path)) {
    let refHost: string | null = null;
    try {
      const ref = (await headers()).get("referer");
      refHost = ref ? new URL(ref).host.slice(0, 120) : null;
    } catch {
      refHost = null;
    }
    await logNotFound(path, refHost, now());
  }
  notFound();
}
