import rulesFile from "./portal-rules.json";
import { parseListingPage, parseStoreListPage, type FetchedPage, type PortalHtmlRules, type StoreListResult } from "./parse-core";
import type { ProbeReply } from "../../worker/core";

/**
 * Portal HTML adaptörü üreticisi (SAF). Her portal kendi dosyasında (`sahibinden-html.ts`, `hepsiemlak-html.ts`,
 * `emlakjet-html.ts`) kendi kurallarını `portal-rules.json`'dan alır; kural dosyası SÜRÜMLÜDÜR ve doğrulanmamıştır
 * (`verified: false`): kalıp tutmazsa sonuç "kontrol edilemedi" olur.
 */

export type PortalRulesFile = { version: string; verified: boolean; portals: Record<string, PortalHtmlRules> };

export const PORTAL_RULES = rulesFile as unknown as PortalRulesFile;
export const PORTAL_RULES_VERSION = PORTAL_RULES.version;
/** Ayrıştırıcı motor sürümü: katman/karar mantığı değişince artırılır (kural sürümü ayrıca `portal-rules.json`). */
export const PARSER_ENGINE_VERSION = "e2";
/** Sonuçla birlikte sunucuya gider: `motor@kural`. Sunucu hangi sürümün ne kadar "kontrol edilemedi" ürettiğini görür. */
export const PARSER_VERSION = `${PARSER_ENGINE_VERSION}@${PORTAL_RULES.version}`;

export type HtmlAdapter = {
  id: string;
  label: string;
  hosts: readonly string[];
  rulesVersion: string;
  rulesVerified: boolean;
  /** URL bu portalın alanında mı (https + izinli host; mağaza/liste sayfası için). */
  isPortalUrl(url: string): boolean;
  /** URL bu portalın ilan sayfası mı (https + izinli host + ilan yolu kalıbı). */
  isListingUrl(url: string): boolean;
  parseListing(page: FetchedPage, expectedId: string | null): ProbeReply;
  parseStore(page: FetchedPage): StoreListResult;
};

export function createHtmlAdapter(id: string, rules: PortalHtmlRules | undefined): HtmlAdapter {
  if (!rules) throw new Error(`Portal kuralı yok: ${id}`);
  let pathRe: RegExp | null = null;
  try {
    pathRe = new RegExp(rules.listingPath);
  } catch {
    pathRe = null;
  }
  const portalUrl = (url: string): URL | null => {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (u.protocol !== "https:" || u.username || u.password) return null;
      return rules.hosts.some((h) => host === h || host.endsWith(`.${h}`)) ? u : null;
    } catch {
      return null;
    }
  };
  return {
    id,
    label: rules.label,
    hosts: rules.hosts,
    rulesVersion: PORTAL_RULES.version,
    rulesVerified: PORTAL_RULES.verified === true,
    isPortalUrl: (url: string) => portalUrl(url) !== null,
    isListingUrl(url: string) {
      const u = portalUrl(url);
      return u !== null && pathRe !== null && pathRe.test(u.pathname);
    },
    parseListing: (page, expectedId) => ({ ...parseListingPage(rules, page, expectedId), parserVersion: PARSER_VERSION }),
    parseStore: (page) => parseStoreListPage(rules, page),
  };
}
