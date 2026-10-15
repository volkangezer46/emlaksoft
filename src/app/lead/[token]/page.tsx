import { notFound } from "next/navigation";
import { Home, MapPin, Search } from "lucide-react";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { provinceOptionsResult } from "@/lib/geo/reader";
import { PublicStateBox, PublicTokenPage } from "@/components/public/token-page";
import { loadLeadListing, normalizeListingRef, type LeadListing } from "@/lib/lead-listing";
import { LeadForm } from "./lead-form";
import { getLeadFormCopy } from "@/lib/legal-copy-server";

export const dynamic = "force-dynamic";

// Token'lı kişiye özel başvuru formu: arama motorlarına kapalı (robots.txt Disallow'a ek olarak meta noindex).
export const metadata = { robots: { index: false, follow: false } };

/**
 * Ofis markalı talep formu (COM-13). Public yüzey her zaman AÇIK temadadır; logo ve marka rengi ortak token'lı sayfa
 * kabuğundan (`PublicTokenPage`) gelir. `?ilan=<kimlik|kod>` verilirse sunucu yalnız bu ofisin yayındaki portföyünü
 * doğrular ve formun üstünde kart olarak gösterir; talep o portföye bağlanır (doğrulanmayan değer yok sayılır).
 */
export default async function PublicLeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ ilan?: string | string[] }>;
}) {
  const { token } = await params;
  const sp = (await searchParams) ?? {};
  const ilanRaw = Array.isArray(sp.ilan) ? sp.ilan[0] : sp.ilan;
  const listingRef = normalizeListingRef(ilanRaw);
  const admin = createAdminClient();

  // tenant ve provinces bağımsız → paralel
  const [{ data: tenant }, { data: provinces }, copy] = await Promise.all([
    admin
      .from("tenants")
      .select("id, name, slug, status, logo_url, brand_color, lead_capture_enabled")
      .eq("lead_capture_token", token)
      .maybeSingle(),
    provinceOptionsResult(),
    // Onay/aydınlatma/pazarlama metinleri yönetimden (yoksa legal-copy.ts); rıza kanıtı sürümü aynı metinden türetilir.
    getLeadFormCopy(),
  ]);

  if (!tenant || !isPublicTenantActive(tenant.status)) notFound();

  const closed = tenant.lead_capture_enabled === false;
  const listing: LeadListing | null = listingRef && !closed ? await loadLeadListing(admin, String(tenant.id), ilanRaw) : null;
  const office = tenant.name || "Emlak ofisi";

  return (
    <PublicTokenPage
      office={office}
      logoUrl={tenant.logo_url ?? null}
      brandColor={tenant.brand_color ?? null}
      icon={listing ? Home : Search}
      title={listing ? "Bu ilanla ilgileniyorum" : "Size en uygun mülkü bulalım"}
      subtitle={
        listing
          ? "Bilgilerinizi bırakın; ilanın danışmanı sizi kısa süre içinde arasın."
          : "Talebinizi bırakın, uzman danışmanımız kısa süre içinde sizinle iletişime geçsin."
      }
      purpose="Bu sayfa yalnızca talep ve başvuru içindir"
      width="lg"
      footerExtra={
        tenant.slug ? (
          <p>
            <Link
              href={`/vitrin/${tenant.slug}`}
              className="focus-ring rounded-sm font-semibold underline-offset-2 transition hover:text-text-muted hover:underline"
            >
              {office} portföylerini inceleyin
            </Link>
          </p>
        ) : null
      }
    >
      {closed ? (
        <PublicStateBox
          icon={Search}
          title="Bu form şu anda kapalı."
          description="Lütfen daha sonra tekrar deneyin ya da ofisi doğrudan arayın."
        />
      ) : (
        <>
          {listing ? (
            <div
              className="mb-4 flex items-start gap-3 rounded-[var(--radius-card)] border px-3.5 py-3"
              style={{ borderColor: "var(--pb-edge)", backgroundColor: "var(--pb-veil)" }}
            >
              <span
                aria-hidden="true"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)]"
                style={{ backgroundColor: "var(--pb-soft)", color: "var(--pb-ink)" }}
              >
                <Home className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">
                  İlgilendiğiniz ilan{listing.code ? ` · ${listing.code}` : ""}
                </p>
                <p className="mt-0.5 line-clamp-2 text-sm font-bold text-ink-950">{listing.title ?? "Portföy"}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                  {listing.priceText ? <span className="font-semibold text-ink-950">{listing.priceText}</span> : null}
                  {listing.place ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" aria-hidden="true" /> {listing.place}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          ) : null}
          <LeadForm
            token={token}
            provinces={provinces ?? []}
            vitrinSlug={tenant.slug ?? null}
            copy={copy}
            listingRef={listing ? listing.id : null}
          />
        </>
      )}
    </PublicTokenPage>
  );
}
