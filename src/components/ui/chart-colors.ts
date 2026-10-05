/**
 * Grafik palet sırası — recharts import etmez (hafif; server/istemci güvenli).
 * Tek kaynak `--viz-1..8` tokenlarıdır (tokens.css / theme-dark.css): iki temada da
 * --surface üzerinde >=3:1 (src/lib/viz-palette-contract.test.ts). Sıra: mavi, yeşil-teal,
 * turuncu, mor, amber, pembe, cyan, nötr. Çok serili grafikte renge ek olarak etiket/lejant
 * kullanılır (yalnız renkle ayrım yok).
 */
export const CHART_COLORS = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
  "var(--viz-7)",
  "var(--viz-8)",
] as const;
