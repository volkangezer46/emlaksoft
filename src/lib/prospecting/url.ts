import { getAdapter } from "@/lib/listing-control/adapters";
import { CURRENT_PORTALS } from "@/lib/portals/catalog";
import type { FsboPortal } from "./types";

const KNOWN: readonly Exclude<FsboPortal, "other">[] = CURRENT_PORTALS;

export type ParsedListingUrl = { portal: FsboPortal; externalId: string | null; url: string };

/**
 * İlan bağlantısı → portal + ilan no + kanonik adres (SAF, ağ yok; sunucu portal sayfasını ÇEKMEZ).
 * Yalnız https/http ve bilinen portal host'ları kabul edilir; diğer adresler reddedilir (null). İlan no kalıbı tutmazsa
 * portal tanınır ama `externalId` null kalır (yanlış id üretilmez).
 */
export function parseListingUrl(raw: string | null | undefined): ParsedListingUrl | null {
  const text = (raw ?? "").trim();
  if (!text || text.length > 600) return null;
  let host: string;
  try {
    const u = new URL(text);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const portal of KNOWN) {
    const adapter = getAdapter(portal);
    if (!adapter) continue;
    if (!adapter.hosts.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    const norm = adapter.normalize({ url: text });
    if (norm) return { portal, externalId: norm.externalId, url: norm.url ?? text };
    // Kalıp tutmadı: kanonik adres (sorgu/parça atılmış) ile portal tanınır.
    const u = new URL(text);
    return { portal, externalId: null, url: `https://${u.hostname}${u.pathname}` };
  }
  return null;
}
