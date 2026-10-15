import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Building2, SearchX } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";
import { LazyLeadForm } from "../lazy-islands";
import { readRemovedListing } from "./removed-listing";

/**
 * İlan detayı 404 (SK8 B153): gerçek HTTP 404 + ofis markalı görünüm. Bağlam sayfadan istek kapsamlı yuvayla gelir
 * (`removed-listing.ts`); ofis yoksa/pasifse genel "bağlantı geçersiz" ekranı (pazarlama bağlantısı yok).
 * Arama motoru: Next 404 yanıtına `noindex` ekler.
 */
export const metadata = { title: "İlan yayından kalktı" };

export default async function VitrinListingNotFound() {
  const ctx = await readRemovedListing();
  if (!ctx) {
    return (
      <PublicLinkNotFound
        icon={SearchX}
        title="İlan bulunamadı"
        description="Aradığınız ilan yayında değil ya da bağlantı hatalı. İlanı paylaşan ofisle iletişime geçebilirsiniz."
      />
    );
  }
  return (
    <main id="main-content" className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Link
          href={`/vitrin/${ctx.slug}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {ctx.office} vitrini
        </Link>

        <section className="mt-4 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-6">
            <div className="flex items-center gap-3">
              {ctx.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- kiracı logosu keyfi Storage URL'i
                <img src={ctx.logoUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-[var(--radius-card)] bg-white object-contain" />
              ) : (
                <span
                  className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] text-base font-extrabold text-white"
                  style={{ background: ctx.brandColor || "var(--grad-brand)" }}
                >
                  {ctx.office[0] ?? "E"}
                </span>
              )}
              <p className="font-display text-base font-extrabold text-ink-950">{ctx.office}</p>
            </div>
            <h1 className="mt-5 font-display text-2xl font-extrabold text-ink-950">
              {ctx.removed ? "Bu ilan yayından kalktı" : "İlan bulunamadı"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              {ctx.removed
                ? "Bu portföy satıldı, kiralandı ya da ofis tarafından yayından kaldırıldı. Benzer ilanlara göz atabilir ya da aradığınızı bize iletebilirsiniz."
                : "Bağlantı hatalı ya da ilan kaldırılmış olabilir. Ofisin yayındaki portföylerine göz atabilirsiniz."}
            </p>
            <Link
              href={`/vitrin/${ctx.slug}`}
              className="focus-ring press mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-card)] bg-brand-600 px-5 text-sm font-bold text-white transition hover:bg-brand-700"
            >
              Yayındaki portföyleri gör
            </Link>
          </div>

          {ctx.leadToken ? (
            <div className="theme-dark overflow-hidden rounded-[var(--radius-panel)] border border-line bg-[#071a38] p-6">
              <h2 className="font-display text-lg font-extrabold text-white">Aradığınızı bize iletin</h2>
              <p className="mt-1 text-sm text-white/55">Kriterlerinize uygun portföy çıktığında danışmanımız sizi arasın.</p>
              <LazyLeadForm token={ctx.leadToken} provinces={ctx.provinces} vitrinSlug={ctx.slug} />
            </div>
          ) : null}
        </section>

        {ctx.similar.length > 0 ? (
          <section className="mt-10" aria-labelledby="benzer-ilanlar">
            <h2 id="benzer-ilanlar" className="font-display text-xl font-extrabold text-ink-950">Benzer ilanlar</h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {ctx.similar.map((p) => (
                <Link
                  key={p.id}
                  href={`/vitrin/${ctx.slug}/${p.id}`}
                  className="lift group block overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface transition hover:border-brand-300"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-ink-950/5">
                    {p.coverId ? (
                      <Image
                        src={`/api/property-media/${p.coverId}`}
                        alt={p.title}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-text-faint">
                        <Building2 className="h-10 w-10" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-1 font-display font-bold text-ink-950">{p.title}</p>
                    {p.district ? <p className="mt-1 text-xs text-text-muted">{p.district}</p> : null}
                    <p className="mt-2 font-display text-lg font-extrabold text-brand-600">{p.price}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
