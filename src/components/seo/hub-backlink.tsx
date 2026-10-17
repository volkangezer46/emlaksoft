import Link from "next/link";
import { slugifyTr } from "@/lib/vitrin/listing-slug";
import { loadHubIndex } from "@/lib/seo/hubs/data";
import { hubDecision, hubPath, hubTitle, intentSlug, txSlugOf } from "@/lib/seo/hubs/rules";
import { getHubSettings } from "@/lib/seo/store";

/**
 * İlan sayfasından ilgili BÖLGE sayfasına iç bağlantı (ilan → ilçe niyet sayfası → il). Yalnız: programatik sayfalar
 * açık + "ilan sayfalarından bağlantı" ayarı açık (varsayılan KAPALI: bölge sayfası diğer ofislerin ilanlarını da
 * listeler) + hedef sayfa indekslenebilir (eşiği geçmiş). Aksi hâlde hiçbir şey çizmez.
 */
export async function HubBacklink({ province, district, tx, propertyType }: { province: string | null; district: string | null; tx: string | null; propertyType: string | null }) {
  const settings = await getHubSettings();
  if (!settings.enabled || !settings.listingLinks) return null;
  const il = slugifyTr(province);
  const ilce = slugifyTr(district);
  const t = txSlugOf(tx);
  const type = slugifyTr(propertyType);
  if (!il || !ilce || !t || !type) return null;
  const { hubs } = await loadHubIndex().catch(() => ({ hubs: [] }));
  const targets = [hubPath({ il, ilce, intent: intentSlug({ tx: t, type }) }), hubPath({ il, ilce }), hubPath({ il })]
    .map((p) => hubs.find((h) => h.path === p))
    .filter((h): h is NonNullable<typeof h> => Boolean(h) && hubDecision(h!.count, settings) === "index");
  if (targets.length === 0) return null;
  return (
    <nav aria-label="Bölge sayfaları" className="mt-10">
      <ul className="flex flex-wrap gap-2">
        {targets.map((h) => (
          <li key={h.path}>
            <Link prefetch={false} href={h.path} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink-950 hover:border-brand-600">
              {hubTitle(h)} ({h.count.toLocaleString("tr-TR")})
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
