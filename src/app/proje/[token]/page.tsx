import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Building2, CalendarDays, Info, KeyRound, LayoutGrid, MapPin, Ruler } from "lucide-react";
import { brandTheme } from "@/components/public/brand";
import { PublicBrandBand, PublicFooterNote } from "@/components/public/token-page";
import { PublicContactActions } from "@/components/public/public-contact-actions";
import { ShareButton } from "@/components/public/share-button";
import { GalleryLightbox } from "@/components/public/gallery-lightbox";
import { PublicModuleClosed } from "@/components/modules/public-module-closed";
import { officeMessageHref, resolvePublicContact } from "@/lib/public-contact";
import { loadPublicProject, type PublicProjectUnit } from "@/lib/projects/public-project";
import { PROJECT_STATUS_LABELS } from "@/lib/status-labels";

export const dynamic = "force-dynamic";

// Token'lı proje sayfası: arama motorlarına kapalı (robots.txt Disallow'a ek olarak meta noindex), sitemap'e girmez.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const data = await loadPublicProject(token);
  const robots = { index: false, follow: false };
  if (!data || data.state !== "ok") return { title: "Proje", robots };
  const title = `${data.project.name} · ${data.office.name}`;
  const description = `${data.totals.available} müsait daire${data.project.area ? ` · ${data.project.area}` : ""}`.slice(0, 160);
  return {
    title: { absolute: title },
    description,
    robots,
    openGraph: { type: "website", locale: "tr_TR", siteName: data.office.name, title, description },
  };
}

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

function floorLabel(f: number | null) {
  return f == null ? "—" : f === 0 ? "Zemin" : f < 0 ? `${f}. bodrum` : `${f}. kat`;
}

/** Oda tipine göre özet: "2+1 · 6 daire · 4.250.000 ₺'den". */
function roomSummary(units: PublicProjectUnit[]) {
  const by = new Map<string, { count: number; min: number | null; minSqm: number | null; maxSqm: number | null }>();
  for (const u of units) {
    const key = u.rooms ?? "Diğer";
    const g = by.get(key) ?? { count: 0, min: null, minSqm: null, maxSqm: null };
    g.count += 1;
    if (u.price != null) g.min = g.min == null ? u.price : Math.min(g.min, u.price);
    if (u.gross_m2 != null) {
      g.minSqm = g.minSqm == null ? u.gross_m2 : Math.min(g.minSqm, u.gross_m2);
      g.maxSqm = g.maxSqm == null ? u.gross_m2 : Math.max(g.maxSqm, u.gross_m2);
    }
    by.set(key, g);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b, "tr", { numeric: true }));
}

/**
 * PF-04 — Proje paylaşım sayfası (/proje/[token]): kapak + galeri, konum, teslim tarihi, oda tipi özeti ve müsait
 * daire fiyat listesi. Danışmanın WhatsApp'la gönderdiği link; yazdırılabilir (fiyat listesi çıktısı). Herkese açık
 * yüzey her zaman açık temadadır; iletişim TEK kaynaktan (`resolvePublicContact`). Rezerve/satılmış dairenin alıcısı
 * ya da iç not hiç okunmaz.
 */
export default async function PublicProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadPublicProject(token);
  if (!data) notFound();
  if (data.state === "closed") return <PublicModuleClosed officeName={data.office.name} />;

  const { office, project, units, totals, media, showPrices } = data;
  const theme = brandTheme(office.brandColor);
  const contact = resolvePublicContact({
    advisorPhone: data.advisor?.phone ?? null,
    officePhone: office.phone,
    whatsappText: `Merhaba, "${project.name}" projesindeki müsait daireler hakkında bilgi almak istiyorum.`,
  });
  const messageHref = officeMessageHref({ lead_capture_token: office.leadToken, lead_capture_enabled: office.leadEnabled });
  const photos = media.filter((m) => m.kind === "image");
  const plans = media.filter((m) => m.kind === "floorplan");
  const prices = units.map((u) => u.price).filter((p): p is number => p != null);
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const delivery = project.deliveryDate
    ? new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(project.deliveryDate))
    : null;
  const rooms = roomSummary(units);

  return (
    <div className="min-h-screen bg-canvas px-4 py-6 sm:py-10" style={theme.style}>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="no-print flex items-center justify-between gap-3">
          <PublicBrandBand office={office.name} logoUrl={office.logoUrl} />
          <ShareButton title={`${project.name} — ${office.name}`} text="Müsait daireler ve fiyat listesi" />
        </div>

        <main id="main-content" className="print-sheet surface-card overflow-hidden rounded-[var(--radius-panel)]">
          {photos.length > 0 ? (
            <div className="no-print">
              <GalleryLightbox
                images={photos.map((p) => ({ id: p.id, src: p.url ?? undefined, alt: p.caption ?? project.name }))}
                alt={project.name}
                priority
                mainClassName="relative aspect-[16/10] w-full sm:aspect-[16/8]"
                thumbsClassName="grid grid-cols-4 gap-2 p-2 sm:grid-cols-6"
                sizes="(max-width: 896px) 100vw, 896px"
              />
            </div>
          ) : null}

          <div className="space-y-6 px-5 py-6 sm:px-8 sm:py-8">
            <header>
              <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: "var(--pb-ink)" }}>
                {project.developer ?? office.name}
                {PROJECT_STATUS_LABELS[project.status] ? ` · ${PROJECT_STATUS_LABELS[project.status]}` : ""}
              </p>
              <h1 className="mt-1 text-balance font-display text-2xl font-extrabold tracking-[-0.02em] text-ink-950 sm:text-3xl">
                {project.name}
              </h1>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-text-muted">
                {project.area || project.location ? (
                  <li className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 shrink-0" aria-hidden /> {[project.location, project.area].filter(Boolean).join(" · ")}
                  </li>
                ) : null}
                {delivery ? (
                  <li className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 shrink-0" aria-hidden /> Teslim: {delivery}
                  </li>
                ) : null}
                <li className="flex items-center gap-1.5">
                  <KeyRound className="h-4 w-4 shrink-0" aria-hidden /> {totals.available} müsait daire
                  {totals.all > 0 ? ` / ${totals.all}` : ""}
                </li>
              </ul>
              {project.description ? (
                <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-text-muted">{project.description}</p>
              ) : null}
            </header>

            {/* İletişim — ilk ekranda (mobilde fiyat listesine inmeden ulaşılır). */}
            <div className="no-print rounded-[var(--radius-card)] border border-line bg-canvas p-4">
              <p className="text-sm font-semibold text-ink-950">
                {data.advisor ? `${data.advisor.name}${data.advisor.title ? ` · ${data.advisor.title}` : ""}` : office.name}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">Daireyi yerinde görmek ya da ödeme seçenekleri için bize ulaşın.</p>
              <PublicContactActions contact={contact} tone="light" fallbackHref={messageHref} className="mt-3 grid gap-2 sm:grid-cols-2" />
            </div>

            {rooms.length > 0 ? (
              <section aria-labelledby="oda-tipleri" className="print-avoid-break">
                <h2 id="oda-tipleri" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
                  <LayoutGrid className="h-4 w-4" style={{ color: "var(--pb-ink)" }} aria-hidden /> Daire tipleri
                </h2>
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {rooms.map(([room, g]) => (
                    <li key={room} className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-3">
                      <p className="font-display text-lg font-extrabold text-ink-950">{room}</p>
                      <p className="text-xs text-text-muted">
                        {g.count} müsait
                        {g.minSqm != null ? ` · ${g.minSqm === g.maxSqm ? g.minSqm : `${g.minSqm}–${g.maxSqm}`} m²` : ""}
                      </p>
                      <p className="numeric mt-1 text-sm font-bold text-ink-950">
                        {showPrices && g.min != null ? `${money(g.min)}'den` : "Fiyat için arayın"}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="fiyat-listesi">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 id="fiyat-listesi" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
                  <Building2 className="h-4 w-4" style={{ color: "var(--pb-ink)" }} aria-hidden /> Müsait daireler
                </h2>
                {showPrices && minPrice != null ? (
                  <p className="text-xs font-semibold text-text-muted">{money(minPrice)}&apos;den başlayan fiyatlarla</p>
                ) : null}
              </div>
              {units.length === 0 ? (
                <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
                  Şu an müsait daire yok. Yeni etap ve vazgeçilen daireler için bize ulaşın.
                </p>
              ) : (
                <>
                  {/* Mobil: kart listesi */}
                  <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line sm:hidden">
                    {units.map((u) => (
                      <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-ink-950">
                            {u.block ? `${u.block} Blok · ` : ""}Daire {u.unit_no}
                          </p>
                          <p className="text-xs text-text-muted">
                            {[floorLabel(u.floor), u.rooms, u.gross_m2 != null ? `${u.gross_m2} m²` : null].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <p className="numeric shrink-0 text-right text-sm font-bold text-ink-950">
                          {u.price != null ? money(u.price) : <span className="text-xs font-semibold text-text-muted">Fiyat için arayın</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {/* Masaüstü + çıktı: tablo */}
                  <div className="mt-3 hidden overflow-hidden rounded-[var(--radius-card)] border border-line sm:block print:block">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-canvas text-xs text-text-faint">
                        <tr>
                          {["Blok", "Kat", "Daire", "Oda", "Brüt m²"].map((h) => (
                            <th key={h} scope="col" className="px-4 py-2.5 font-semibold">
                              {h}
                            </th>
                          ))}
                          <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                            Fiyat
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {units.map((u) => (
                          <tr key={u.id}>
                            <td className="px-4 py-2.5">{u.block ?? "—"}</td>
                            <td className="px-4 py-2.5">{floorLabel(u.floor)}</td>
                            <td className="px-4 py-2.5 font-semibold text-ink-950">{u.unit_no}</td>
                            <td className="px-4 py-2.5">{u.rooms ?? "—"}</td>
                            <td className="numeric px-4 py-2.5">{u.gross_m2 ?? "—"}</td>
                            <td className="numeric px-4 py-2.5 text-right font-bold text-ink-950">
                              {u.price != null ? money(u.price) : <span className="text-xs font-semibold text-text-muted">Fiyat için arayın</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            {plans.length > 0 ? (
              <section aria-labelledby="kat-planlari" className="no-print">
                <h2 id="kat-planlari" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
                  <Ruler className="h-4 w-4" style={{ color: "var(--pb-ink)" }} aria-hidden /> Kat planları
                </h2>
                <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-line">
                  <GalleryLightbox
                    images={plans.map((p) => ({ id: p.id, src: p.url ?? undefined, alt: p.caption ?? `${project.name} kat planı` }))}
                    alt={`${project.name} kat planı`}
                    mainClassName="relative aspect-[4/3] w-full bg-surface"
                    thumbsClassName="grid grid-cols-4 gap-2 p-2 sm:grid-cols-6"
                  />
                </div>
              </section>
            ) : null}

            <p className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Bilgiler {office.name} tarafından paylaşılmıştır. Fiyatlar liste fiyatıdır; müsaitlik ve fiyat
                önceden haber verilmeksizin değişebilir. Kesin bilgi ve ödeme planı için ofisle görüşün.
              </span>
            </p>
          </div>
        </main>

        <PublicFooterNote purpose="Bu sayfa yalnızca proje tanıtımı içindir" />
      </div>
    </div>
  );
}
