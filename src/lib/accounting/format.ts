/** Muhasebe gösterim biçimleri (SAF). Kuruş girer, TR biçimli metin çıkar. */
const TRY = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatKurus(kurus: number): string {
  return TRY.format(kurus / 100);
}

/** Büyük sayılarda kuruşsuz kısa biçim (kart değerleri). */
const TRY0 = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
export function formatKurusShort(kurus: number): string {
  return TRY0.format(kurus / 100);
}

export function formatTl(tl: number): string {
  return TRY.format(tl);
}
