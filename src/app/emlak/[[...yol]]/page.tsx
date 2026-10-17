import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs } from "@/app/rehber/guide-ui";
import { ToolsShell } from "@/components/tools/tools-shell";
import { getBaseUrl } from "@/lib/base-url";
import { formatTry } from "@/lib/format";
import { serializeJsonLd } from "@/lib/seo/jsonld";
import { loadHubIndex } from "@/lib/seo/hubs/data";
import {
  HUB_BASE,
  hubChildren,
  hubCrumbs,
  hubDecision,
  hubDescription,
  hubFaq,
  hubH1,
  hubIntro,
  hubJsonLd,
  hubLinkLabel,
  hubPath,
  hubStats,
  hubTitle,
  listingsForHub,
  parseHubSegments,
  priceWord,
  statsOptionsFor,
  type HubListing,
  type HubSummary,
} from "@/lib/seo/hubs/rules";
import { buildMetadata, getHubSettings } from "@/lib/seo/store";

/**
 * PROGRAMATİK BÖLGE SAYFALARI (/emlak/...). Kurallar `src/lib/seo/hubs/rules.ts` (SAF): yalnız arama onayı veren
 * ofislerin gerçek, yayındaki ilanları; ilan sayısı eşiğin altındaysa `noindex, follow`, hiç ilan yoksa 404; özellik
 * kapalıyken tüm yol 404. Sunucu bileşeni (istemci JS yok), ISR 30 dk (veri önbelleği `seo-hubs`).
 */
export const revalidate = 1800;

type Props = { params: Promise<{ yol?: string[] }> };

const LISTING_LIMIT = 60;

async function resolve(segs: readonly string[]) {
  const settings = await getHubSettings();
  if (!settings.enabled) return null;
  const ref = parseHubSegments(segs);
  if (!ref) return null;
  const { listings, hubs } = await loadHubIndex();
  if (ref === "root") return { kind: "root" as const, hubs, settings };
  const path = hubPath(ref);
  const hub = hubs.find((h) => h.path === path);
  if (!hub) return null;
  const decision = hubDecision(hub.count, settings);
  if (decision === "notfound") return null;
  const list = listingsForHub(listings, ref).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id));
  return { kind: "hub" as const, hub, hubs, list, decision, stats: hubStats(list, statsOptionsFor(hub.intent)) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const segs = (await params).yol ?? [];
  const r = await resolve(segs);
  if (!r) return buildMetadata(HUB_BASE, { title: "Bulunamadı", noindex: true });
  if (r.kind === "root") {
    return buildMetadata(HUB_BASE, {
      title: "Bölgelere göre emlak ilanları",
      description: "İl ve ilçelere göre güncel satılık ve kiralık emlak ilanları; ilanlar arama onayı veren emlak ofislerinin vitrinlerinden gelir.",
    });
  }
  return buildMetadata(r.hub.path, { title: hubTitle(r.hub), description: hubDescription(r.hub, r.stats), noindex: r.decision !== "index" });
}

export default async function HubPage({ params }: Props) {
  const segs = (await params).yol ?? [];
  const r = await resolve(segs);
  if (!r) notFound();
  if (r.kind === "root") return <RootView hubs={r.hubs} min={r.settings.minListings} />;
  return <HubView hub={r.hub} hubs={r.hubs} list={r.list} stats={r.stats} />;
}

function RootView({ hubs, min }: { hubs: readonly HubSummary[]; min: number }) {
  const cities = hubs.filter((h) => h.level === "il" && !h.intent && h.count >= 1).sort((a, b) => b.count - a.count || a.geo.il.name.localeCompare(b.geo.il.name, "tr"));
  return (
    <ToolsShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Crumbs items={[{ name: "Ana sayfa", path: "/" }, { name: "Emlak ilanları" }]} />
        <h1 className="mt-1 font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">Bölgelere göre emlak ilanları</h1>
        <p className="mt-3 max-w-2xl text-text-muted">İlanlar, aramalarda görünmeyi kabul eden emlak ofislerinin vitrinlerinden gelir. En az {min} ilanı olan bölgeler arama motorlarına açıktır.</p>
        {cities.length === 0 ? (
          <p className="mt-8 text-text-muted">Şu anda listelenecek bölge yok.</p>
        ) : (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cities.map((h) => (
              <li key={h.path}>
                <Link prefetch={false} href={h.path} className="flex min-h-11 items-center justify-between rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 font-semibold text-ink-950 hover:border-brand-600">
                  <span>{h.geo.il.name}</span>
                  <span className="text-sm font-normal text-text-muted">{h.count.toLocaleString("tr-TR")} ilan</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ToolsShell>
  );
}

function HubView({ hub, hubs, list, stats }: { hub: HubSummary; hubs: readonly HubSummary[]; list: readonly HubListing[]; stats: ReturnType<typeof hubStats> }) {
  const crumbs = hubCrumbs(hub);
  const faq = hubFaq(hub, stats);
  const intro = hubIntro(hub, stats);
  const children = hubChildren(hubs, hub.ref);
  // Kardeş niyetler: aynı bölgedeki diğer niyet sayfaları (yatay iç bağlantı).
  const siblings = hub.intent
    ? hubs
        .filter((h) => h.path !== hub.path && h.intent && h.ref.il === hub.ref.il && h.ref.ilce === hub.ref.ilce && h.ref.mahalle === hub.ref.mahalle)
        .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
        .slice(0, 12)
    : [];
  const shown = list.slice(0, LISTING_LIMIT);
  const h1 = hubH1(hub);
  const ld = hubJsonLd({ base: getBaseUrl(), path: hub.path, name: h1, description: hubDescription(hub, stats), listings: shown, crumbs, faq });
  return (
    <ToolsShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(ld) }} />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Crumbs items={crumbs} />
        <h1 className="mt-1 font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">{h1}</h1>
        <div className="mt-3 max-w-3xl space-y-2 text-text-muted">
          {intro.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        <dl className="mt-6 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Yayındaki ilan" value={stats.count.toLocaleString("tr-TR")} />
          {stats.medianPrice ? <Stat label={`Medyan ${priceWord(hub.intent)}`} value={formatTry(stats.medianPrice)} /> : null}
          {stats.medianPricePerSqm ? <Stat label="Medyan m² fiyatı" value={formatTry(stats.medianPricePerSqm)} /> : null}
        </dl>

        <h2 className="mt-10 font-display text-2xl font-extrabold text-ink-950">İlanlar</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((l) => (
            <li key={l.id}>
              <Link prefetch={false} href={l.href} className="flex h-full min-h-11 flex-col rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-600">
                <span className="font-semibold text-ink-950">{l.title}</span>
                <span className="mt-1 text-sm text-text-muted">
                  {[l.rooms?.label, l.sqm ? `${l.sqm.toLocaleString("tr-TR")} m²` : null, l.mahalle?.name ?? l.ilce?.name ?? l.il.name].filter(Boolean).join(" · ")}
                </span>
                <span className="mt-auto pt-2 text-base font-bold text-ink-950">{l.priceText ?? "Fiyat için sorun"}</span>
                <span className="text-xs text-text-muted">{l.officeName}</span>
              </Link>
            </li>
          ))}
        </ul>
        {list.length > shown.length ? <p className="mt-3 text-sm text-text-muted">En yeni {shown.length} ilan gösteriliyor (toplam {list.length.toLocaleString("tr-TR")}).</p> : null}

        {children.length > 0 ? (
          <LinkGroup title={hub.ref.ilce ? (hub.intent ? "Mahallelere göre" : "Bu bölgede ara") : "İlçelere göre"} items={children} />
        ) : null}
        {siblings.length > 0 ? <LinkGroup title="Benzer aramalar" items={siblings} /> : null}

        {faq.length > 0 ? (
          <section aria-labelledby="sss" className="mt-10 max-w-3xl">
            <h2 id="sss" className="font-display text-2xl font-extrabold text-ink-950">Sık sorulan sorular</h2>
            <div className="mt-4 divide-y divide-line rounded-[var(--radius-card)] border border-line">
              {faq.map((f) => (
                <details key={f.q} className="group p-4">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center font-semibold text-ink-950 [&::-webkit-details-marker]:hidden">{f.q}</summary>
                  <p className="mt-2 text-text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        ) : null}
        <p className="mt-10 text-xs text-text-muted">Fiyatlar ilan fiyatıdır; gerçekleşen satış ya da kira bedelini göstermez. İlan bilgilerinden ilgili emlak ofisi sorumludur.</p>
      </div>
    </ToolsShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface-2 p-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-bold tabular-nums text-ink-950">{value}</dd>
    </div>
  );
}

function LinkGroup({ title, items }: { title: string; items: readonly HubSummary[] }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-extrabold text-ink-950">{title}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((h) => (
          <li key={h.path}>
            <Link prefetch={false} href={h.path} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink-950 hover:border-brand-600">
              {hubLinkLabel(h)} <span className="ml-1.5 font-normal text-text-muted">({h.count.toLocaleString("tr-TR")})</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
