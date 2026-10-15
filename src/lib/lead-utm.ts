/**
 * Talep kaynağına kampanya izi (COM-13): formu açan bağlantı `utm_source` / `utm_campaign` taşıyorsa kaynak
 * "utm_<kaynak>[_<kampanya>]" olur (ör. utm_instagram_bahar) ve Kaynak raporunda ayrışır. SAF; sınırlı ve temiz.
 */

/** utm parçası: küçük harf, yalnız [a-z0-9_.-], en çok 30 karakter (kaynak raporunda kirli değer olmasın). */
export function utmPart(value: unknown): string {
  // utm değerleri çoğunlukla İngilizce ("Instagram"): tr-TR küçültme "I"yı "ı" yapıp düşürürdü; düz küçültme +
  // Türkçe harflerin ASCII karşılığı kullanılır.
  const tr: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return String(value ?? "")
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => tr[c] ?? c)
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function leadSourceWithUtm(source: string, utmSource: unknown, utmCampaign: unknown): string {
  const src = utmPart(utmSource);
  if (!src) return source;
  const campaign = utmPart(utmCampaign);
  return `utm_${src}${campaign ? `_${campaign}` : ""}`.slice(0, 80);
}
