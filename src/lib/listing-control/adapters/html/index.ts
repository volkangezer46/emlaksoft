import { emlakjetHtml } from "./emlakjet-html";
import { hepsiemlakHtml } from "./hepsiemlak-html";
import { sahibindenHtml } from "./sahibinden-html";
import { PARSER_ENGINE_VERSION, PARSER_VERSION, PORTAL_RULES_VERSION, type HtmlAdapter } from "./create";

/**
 * Portal HTML adaptör kaydı (SAF; eklenti ve testler kullanır). Yeni portal: `portal-rules.json`'a kural + kendi
 * `<portal>-html.ts` dosyası + buraya tek satır. Eklenti manifest'indeki `host_permissions` bu listeden üretilir
 * (`scripts/build-extension.ts`); listede olmayan alana eklenti istek ATMAZ.
 */
const ADAPTERS: readonly HtmlAdapter[] = [sahibindenHtml, hepsiemlakHtml, emlakjetHtml];

export function getHtmlAdapter(portal: string | null | undefined): HtmlAdapter | null {
  const id = (portal ?? "").trim().toLowerCase();
  return ADAPTERS.find((a) => a.id === id) ?? null;
}

export function listHtmlAdapters(): readonly HtmlAdapter[] {
  return ADAPTERS;
}

/** Tüm portal alanları (manifest `host_permissions` tek kaynağı). */
export function allPortalHosts(): string[] {
  return [...new Set(ADAPTERS.flatMap((a) => a.hosts))].sort();
}

export { PARSER_ENGINE_VERSION, PARSER_VERSION, PORTAL_RULES_VERSION };
export type { HtmlAdapter };
export type { FetchedPage, StoreItem, StoreListResult } from "./parse-core";
