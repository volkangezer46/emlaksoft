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
