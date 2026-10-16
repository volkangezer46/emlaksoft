/**
 * Kabuk için HAFİF rota -> modül tablosu (yalnız yol önekleri ve anahtarlar).
 *
 * `registry.ts` modül açıklama metinlerini, paket tanımlarını ve plan kapılarını (page-gates -> plans) taşır; menü
 * (nav-config) ve komut paleti yalnız `featureForHref` için onu içe aktarınca bu veri kabuk paketine giriyordu.
 * Bu tablo registry'deki `MODULES[].routes` ile BİREBİR aynı olmak zorundadır (modules.test.ts karşılaştırır).
 */
import type { FeatureKey } from "@/lib/modules/registry";
import { financePath } from "@/lib/finance/routes";

const ROUTES: ReadonlyArray<readonly [string, FeatureKey]> = [
  ["/app/teklifler", "offers"],
  ["/app/sozlesmeler", "contracts"],
  ["/app/onaylar", "approvals"],
  ["/app/anketler", "surveys"],
  ["/app/kampanyalar", "campaigns"],
  ["/app/tavsiyeler", "smart_lists"],
  ["/app/acik-ev", "open_house"],
  ["/app/kiralama", "rentals"],
  ["/app/kira-artis", "rentals"],
  ["/app/projeler", "projects"],
  ["/app/ilan-kontrol/portallar", "portals"],
  ["/app/ilan-kontrol", "portals"],
  ["/app/portfoyler/anahtarlar", "keys"],
  ["/app/portfoyler/sunumlar", "presentations"],
  ["/app/ag", "network"],
  ["/app/yabanci-satis", "foreign_sale"],
  ["/app/degerleme", "valuation"],
  ["/app/hesaplayici", "valuation"],
  [financePath(), "expenses"],
  ["/app/aidat", "expenses"],
  ["/app/raporlar", "reports"],
  ["/app/bolge-analizi", "reports"],
  ["/app/ilan-kontrol/kapanis", "leak"],
  ["/app/danisman-kpi", "team_perf"],
  ["/app/lig", "team_perf"],
  ["/app/hedefler", "team_perf"],
  ["/app/franchise", "franchise"],
  ["/app/pano-tv", "tv_board"],
  ["/app/otomasyonlar", "automation"],
  ["/app/ayarlar/is-akislari", "automation"],
  ["/app/belgeler", "documents"],
  ["/app/asistan", "ai_assistant"],
  ["/app/portfoy-avi", "prospecting"],
];

/**
 * Kapatılabilir bir modülün yolu altında duran ÇEKİRDEK alt yollar: `expenses` (Finans) kapatılsa da komisyon defteri ve
 * hakediş (çekirdek "Anlaşmalar, Komisyon ve Kazanç") açık kalır. Adresler `@/lib/finance/routes` ile aynıdır.
 */
export const CORE_ROUTE_OVERRIDES: readonly string[] = [financePath("komisyon"), financePath("hakedis")];

/** En uzun önek önce. */
export const MODULE_ROUTE_TABLE: ReadonlyArray<{ prefix: string; key: FeatureKey }> = ROUTES.map(([prefix, key]) => ({ prefix, key })).sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

function matches(path: string, prefix: string): boolean {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return p === prefix || p.startsWith(`${prefix}/`);
}

/**
 * Yolun (sorgu/hash atılır) bağlı olduğu kapatılabilir modül; çekirdek yol için null.
 * En uzun önek kazanır (`/app/portfoyler/sunumlar` -> presentations, `/app/portfoyler` -> null).
 */
export function featureForHref(href: string): FeatureKey | null {
  const path = href.split(/[?#]/)[0] ?? href;
  const core = CORE_ROUTE_OVERRIDES.find((prefix) => matches(path, prefix));
  for (const row of MODULE_ROUTE_TABLE) {
    if (!matches(path, row.prefix)) continue;
    // Kapatılabilir modülün altındaki ÇEKİRDEK alt yol (daha uzun önek) kapanmaz: Finans > Komisyon / Hakediş.
    return core && core.length > row.prefix.length ? null : row.key;
  }
  return null;
}
