import { parseInventoryCsv } from "./inventory-csv";
import type { AdapterCapabilities, ObservedListing, PortalAdapter } from "./types";

/**
 * Portal adaptör İSKELETİ üreticisi: URL → ilan no normalizasyonu + CSV dışa aktarım içe aktarma. Ağ çağrısı YOK;
 * resmi API / kullanıcı-destekli yollar bu iskelette KAPALIDIR (capabilities=false) ve ilgili portal için resmi API
 * erişimi / sahip kararı sonrası ayrı dosyada açılır. Portala ait URL kalıbı DOĞRULANMAMIŞTIR (`urlPatternVerified`
 * false): kalıp tutmazsa normalize null döner ve çağıran ilan no'yu elle ister (yanlış id üretmez).
 */

export type SkeletonSpec = {
  id: string;
  label: string;
  hosts: readonly string[];
  /** URL yolundan ilan no çıkaran kalıp (ilk yakalama grubu). */
  idFromPath: RegExp;
  urlPatternVerified: boolean;
};

const BASE_CAPS: AdapterCapabilities = { api: false, feed: false, csvImport: true, userAssisted: false, manual: true };

export function createSkeletonAdapter(spec: SkeletonSpec): PortalAdapter & { urlPatternVerified: boolean } {
  const hostOk = (host: string) => spec.hosts.some((h) => host === h || host.endsWith(`.${h}`));
  return {
    id: spec.id,
    label: spec.label,
    capabilities: { ...BASE_CAPS },
    hosts: spec.hosts,
    urlPatternVerified: spec.urlPatternVerified,
    normalize({ url, externalId }) {
      const manualId = (externalId ?? "").trim();
      let cleanUrl: string | null = null;
      let urlId: string | null = null;
      if (url && url.trim()) {
        try {
          const u = new URL(url.trim());
          if ((u.protocol === "https:" || u.protocol === "http:") && hostOk(u.hostname.toLowerCase())) {
            cleanUrl = `${u.protocol}//${u.hostname}${u.pathname}`;
            urlId = u.pathname.match(spec.idFromPath)?.[1] ?? null;
          }
        } catch {
          /* geçersiz URL: yok sayılır */
        }
      }
      const id = manualId || urlId;
      if (!id) return null;
      if (manualId && urlId && manualId !== urlId) return null; // çelişen id/URL: yanlış eşleştirme yerine reddet
      return { externalId: id, url: cleanUrl };
    },
    parseInventory(format: "csv" | "xml", data: string, seenAt: string): ObservedListing[] {
      if (format !== "csv") return [];
      return parseInventoryCsv(spec.id, data, seenAt);
    },
  };
}
