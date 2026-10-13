/**
 * Robot denetim eşikleri (TEK yer). Kurallar (audit-rules.ts, publish-gate.ts) ve rule-suggest.ts buradan okur.
 * Değer değişikliği bulgu sayılarını değiştirir; testler bu sabitleri içe aktarır.
 */
export const SEO_THRESHOLDS = {
  /** Sitemap'teki indekslenebilir sayfada görünür metin bundan azsa "ince içerik". */
  thinContentWords: 250,
  /** İlk bayta kadar geçen süre (ms) bundan büyükse "yavaş yanıt". */
  slowTtfbMs: 800,
  /** Ham HTML boyutu (bayt) bundan büyükse "HTML çok büyük". */
  htmlTooLargeBytes: 300 * 1024,
  /** Açıklama kısaltma önerisinin hedef uzunluğu (sözcük sınırında). */
  suggestDescriptionMax: 155,
  /** Keşif taramasında ana sayfa/sitemap sayfalarından en çok kaç seviye ilerlenir. */
  discoveryDepth: 2,
  /** Kendi kökenimizdeki OG görseli denetimi: en çok kaç farklı görsel. */
  maxOgImageChecks: 20,
} as const;
