import type { NlChip, NlGroup, NlParam, NlParseResult } from "./parse";

/**
 * Ayrıştırılan filtrelerden mevcut listelerin URL'sini kurar (filtre kontratı: searchParams iki yönlü).
 * Listenin bilmediği filtre sessizce atılmaz; `unsupported` ile kullanıcıya gösterilir.
 */

const PARAM_ORDER: NlParam[] = [
  "islem", "kategori", "oda", "fiyat_min", "fiyat_max", "m2_min", "m2_max", "kat_min", "kat_max", "il", "ilce", "mahalle",
];

export const NL_TARGET_PATH = {
  portfoy: "/app/portfoyler",
  talep: "/app/talepler",
  musteri: "/app/musteriler",
} as const;

export const NL_TARGET_LABEL = {
  portfoy: "Portföyler",
  talep: "Talepler",
  musteri: "Müşteriler",
} as const;

const TALEP_GROUPS = new Set<NlGroup>(["il"]);

export function nlTargetHref(result: NlParseResult): { href: string; unsupported: NlChip[] } {
  const path = NL_TARGET_PATH[result.target];
  const params = new URLSearchParams();

  if (result.target === "portfoy") {
    for (const key of PARAM_ORDER) {
      const v = result.filters[key];
      if (v) params.set(key, v);
    }
    return { href: qs(path, params), unsupported: [] };
  }

  if (result.target === "talep") {
    // Talep listesi yalnız il bilir; ilçe/mahalle seçildiyse il'e daralır.
    if (result.provinceId) params.set("il", result.provinceId);
    const unsupported = result.chips.filter((c) => !TALEP_GROUPS.has(c.group) && !(c.group === "ilce" && result.provinceId));
    return { href: qs(path, params), unsupported };
  }

  // Müşteri listesi yapılandırılmış konum/fiyat filtresi bilmez; yalnız anlaşılamayan metin q olur.
  if (result.unknown.length > 0) params.set("q", result.unknown.join(" ").slice(0, 80));
  return { href: qs(path, params), unsupported: result.chips };
}

function qs(path: string, params: URLSearchParams): string {
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

/** Arama sonuçları sayfasında bir chip'i kaldıran / geri alan bağlantı için haric listesi. */
export function parseExcludeParam(raw: string | undefined, valid: readonly NlGroup[]): NlGroup[] {
  if (!raw) return [];
  const set = new Set(valid);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is NlGroup => set.has(s as NlGroup));
}
