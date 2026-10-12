/**
 * Kabuk için HAFİF rota -> modül tablosu (yalnız yol önekleri ve anahtarlar).
 *
 * `registry.ts` modül açıklama metinlerini, paket tanımlarını ve plan kapılarını (page-gates -> plans) taşır; menü
 * (nav-config) ve komut paleti yalnız `featureForHref` için onu içe aktarınca bu veri kabuk paketine giriyordu.
 * Bu tablo registry'deki `MODULES[].routes` ile BİREBİR aynı olmak zorundadır (modules.test.ts karşılaştırır).
 */
import type { FeatureKey } from "@/lib/modules/registry";

const ROUTES: ReadonlyArray<readonly [string, FeatureKey]> = [
  ["/app/teklifler", "offers"],
  ["/app/sozlesmeler", "contracts"],
  ["/app/onaylar", "approvals"],
  ["/app/kayip-satis", "lost_sales"],
  ["/app/anketler", "surveys"],
  ["/app/kampanyalar", "campaigns"],
  ["/app/akilli-listeler", "smart_lists"],
  ["/app/tavsiyeler", "smart_lists"],
  ["/app/acik-ev", "open_house"],
  ["/app/kiralama", "rentals"],
  ["/app/kira-artis", "rentals"],
  ["/app/projeler", "projects"],
  ["/app/portallar", "portals"],
  ["/app/ilan-kontrol", "portals"],
  ["/app/portfoyler/anahtarlar", "keys"],
  ["/app/portfoyler/sunumlar", "presentations"],
  ["/app/ag", "network"],
  ["/app/yabanci-satis", "foreign_sale"],
  ["/app/degerleme", "valuation"],
  ["/app/hesaplayici", "valuation"],
  ["/app/giderler", "expenses"],
  ["/app/aidat", "expenses"],
  ["/app/raporlar", "reports"],
  ["/app/bolge-analizi", "reports"],
  ["/app/kayip-kacak", "leak"],
  ["/app/ekip/kiyas", "team_perf"],
  ["/app/danisman-kpi", "team_perf"],
  ["/app/lig", "team_perf"],
  ["/app/hedefler", "team_perf"],
  ["/app/franchise", "franchise"],
  ["/app/pano-tv", "tv_board"],
  ["/app/otomasyonlar", "automation"],
  ["/app/ayarlar/is-akislari", "automation"],
  ["/app/belgeler", "documents"],
  ["/app/asistan", "ai_assistant"],
  ["/app/ofis-merkezi", "office_center"],
];

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
  for (const row of MODULE_ROUTE_TABLE) if (matches(path, row.prefix)) return row.key;
  return null;
}
