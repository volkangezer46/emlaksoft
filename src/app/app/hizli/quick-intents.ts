/** "Ne arıyor?" seçimi -> müşteri türü (varsayılan tanımlarla aynı değerler). */
export const QUICK_INTENTS = [
  { id: "al", label: "Almak istiyor" },
  { id: "kirala", label: "Kiralamak istiyor" },
  { id: "sat", label: "Satmak istiyor" },
  { id: "kiraya-ver", label: "Kiraya vermek istiyor" },
] as const;

export type QuickIntent = (typeof QUICK_INTENTS)[number]["id"];

export const QUICK_INTENT_TYPES: Record<QuickIntent, string> = {
  al: "Alıcı",
  kirala: "Kiracı",
  sat: "Satıcı",
  "kiraya-ver": "Mülk sahibi",
};

/** Hızlı portföy oda seçenekleri (serbest değer de girilebilir; tam formla aynı biçim). */
export const QUICK_ROOM_OPTIONS = ["1+0", "1+1", "2+1", "3+1", "4+1", "5+1"] as const;

/**
 * Hızlı portföyde başlık sahada yazılmaz: oda + tür + işlemden üretilir ("3+1 Satılık Daire, 120 m²").
 * Tam formda istenildiği zaman değiştirilir. Boş parçalar atlanır; hiçbiri yoksa "Yeni portföy (taslak)".
 */
export function buildQuickPropertyTitle(i: { rooms?: string | null; propertyType?: string | null; transactionType?: string | null; sqm?: number | null }): string {
  const head = [i.rooms?.trim(), i.transactionType?.trim(), i.propertyType?.trim()].filter(Boolean).join(" ");
  const sqm = i.sqm && i.sqm > 0 ? `${Math.round(i.sqm)} m²` : "";
  const t = [head, sqm].filter(Boolean).join(", ");
  return (t || "Yeni portföy (taslak)").slice(0, 120);
}
