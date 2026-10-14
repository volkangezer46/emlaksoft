/**
 * Portföy durumu / fiyat sağlığı için Türkçe etiketler — tek kaynak.
 * DB ham değer (`live`, `rented`, `green`...) tutar; arayüz asla ham değeri göstermemeli.
 * Bilinmeyen değer ham haliyle değil, "Bilinmiyor" yerine olduğu gibi döner
 * (özel/Türkçe tanımlı durumlar bozulmasın).
 */

const PROPERTY_STATUS_LABEL: Record<string, string> = {
  draft: "Taslak",
  live: "Yayında",
  reserved: "Rezerve",
  sold: "Satıldı",
  rented: "Kiralandı",
  archived: "Arşiv",
  active: "Aktif",
  passive: "Pasif",
  withdrawn: "Geri çekildi",
  pending: "Beklemede",
};

export function propertyStatusLabel(status: string | null | undefined): string {
  if (!status) return "Belirsiz";
  return PROPERTY_STATUS_LABEL[status.toLowerCase()] ?? status;
}

/**
 * Fiyat sağlığı etiketi (TEK ölçek, YD5): liste kapsülü, süzgeç çipleri, dağılım çubuğu, portföy künyesi rozeti ve
 * "Fiyat & değerleme" kutusu aynı kelimeyi kullanır. Girdi kolon ham değeri (green/yellow/red/pending ve Türkçe eşleri)
 * ya da `PriceHealth` bandıdır.
 */
export function priceHealthLabel(health: string | null | undefined): string {
  if (health === "green" || health === "Yeşil") return "Uygun";
  if (health === "yellow" || health === "Sarı") return "İzlenmeli";
  if (health === "red" || health === "Kırmızı") return "Riskli";
  return "Bekliyor";
}
