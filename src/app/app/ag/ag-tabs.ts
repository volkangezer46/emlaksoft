/**
 * Ağ sayfası sekmeleri (OA11; SAF, birim testli). URL kontratı `?sekme=` (yoksa/bilinmiyorsa `havuz`). Her sekme yalnız
 * kendi sorgusunu çalıştırır; sayaç rozetleri bekleyen işi gösterir. Paylaştıklarım altında `?tur=ilan|talep` alt süzgeci.
 */
export const AG_TABS = [
  { id: "havuz", label: "İlan havuzu" },
  { id: "talep-havuzu", label: "Talep havuzu" },
  { id: "paylastiklarim", label: "Paylaştıklarım" },
  { id: "taleplerim", label: "Taleplerim" },
  { id: "onerilerim", label: "Önerilerim" },
] as const;

export type AgTabId = (typeof AG_TABS)[number]["id"];

export function parseAgTab(raw: string | string[] | undefined): AgTabId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return AG_TABS.some((t) => t.id === v) ? (v as AgTabId) : "havuz";
}

export type SharedKind = "ilan" | "talep";
export function parseSharedKind(raw: string | string[] | undefined): SharedKind {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "talep" ? "talep" : "ilan";
}

/** Sekme bağlantısı; ek sorgu (ör. `talep=<id>`) korunur, boş değerler yazılmaz. */
export function agTabHref(id: AgTabId, extra?: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  if (id !== "havuz") p.set("sekme", id);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) p.set(k, v);
  const qs = p.toString();
  return qs ? `/app/ag?${qs}` : "/app/ag";
}
