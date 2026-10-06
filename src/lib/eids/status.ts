/**
 * EİDS durum özeti (SAF): portföy satırlarından Uyum sayfası sayaçları ve portföy listesi süzgeci türetilir.
 * Kapsam: yayın/hazırlık sürecindeki portföyler (satıldı, kiralandı, arşiv, geri çekildi, pasif dışarıda).
 */
import { evaluateAuthorityTerm } from "./authority-term";
import { hasValidEidsNo } from "./property-no";

export type EidsPropertyRow = {
  id: string;
  status: string | null;
  eids_property_no: string | null;
  authorization_start: string | null;
  authorization_end: string | null;
};

/** ?yetki= süzgeç değerleri (portföy listesi URL kontratı). */
export const EIDS_FILTER_VALUES = ["eids_eksik", "yetki_eksik", "kisa", "bitiyor", "dolmus"] as const;
export type EidsFilter = (typeof EIDS_FILTER_VALUES)[number];

export const EIDS_FILTER_LABELS: Record<EidsFilter, string> = {
  eids_eksik: "EİDS no eksik",
  yetki_eksik: "Yetki tarihi eksik",
  kisa: "Yetki 3 aydan kısa",
  bitiyor: "Yetki 15 günde bitiyor",
  dolmus: "Yetki süresi dolmuş",
};

const OUT_OF_SCOPE = new Set(["sold", "rented", "archived", "withdrawn", "passive"]);

export function isEidsFilter(v: string | undefined | null): v is EidsFilter {
  return !!v && (EIDS_FILTER_VALUES as readonly string[]).includes(v);
}

export function isEidsInScope(status: string | null | undefined): boolean {
  return !OUT_OF_SCOPE.has((status ?? "").toLowerCase());
}

export type EidsSummary = {
  scope: number;
  withEidsNo: number;
  ids: Record<EidsFilter, string[]>;
  counts: Record<EidsFilter, number>;
};

export function summarizeEids(rows: readonly EidsPropertyRow[], nowMs: number): EidsSummary {
  const ids: Record<EidsFilter, string[]> = { eids_eksik: [], yetki_eksik: [], kisa: [], bitiyor: [], dolmus: [] };
  let scope = 0;
  let withEidsNo = 0;
  for (const r of rows) {
    if (!isEidsInScope(r.status)) continue;
    scope += 1;
    if (hasValidEidsNo(r.eids_property_no)) withEidsNo += 1;
    else ids.eids_eksik.push(r.id);
    const t = evaluateAuthorityTerm({ start: r.authorization_start, end: r.authorization_end }, nowMs);
    if (t.state === "missing") ids.yetki_eksik.push(r.id);
    if (t.state === "expired") ids.dolmus.push(r.id);
    if (t.state === "expiring") ids.bitiyor.push(r.id);
    if (t.short) ids.kisa.push(r.id);
  }
  const counts = Object.fromEntries(EIDS_FILTER_VALUES.map((k) => [k, ids[k].length])) as Record<EidsFilter, number>;
  return { scope, withEidsNo, ids, counts };
}
