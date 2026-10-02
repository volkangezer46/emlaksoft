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

/** price_health kolonu (green/yellow/red/pending ve Türkçe eşleri) → rozet etiketi. */
export function priceHealthLabel(health: string | null | undefined): string {
  if (health === "green" || health === "Yeşil") return "uygun";
  if (health === "yellow" || health === "Sarı") return "izlenmeli";
  if (health === "red" || health === "Kırmızı") return "riskli";
  return "bekliyor";
}
