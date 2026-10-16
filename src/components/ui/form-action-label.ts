/**
 * Mobil form çubuğunun birincil düğme etiketi (sadeleştirme ilkesi 5: "Kesik metin yok; mobilde buton etiketi tek
 * kelimedir"). "Portföyü oluştur", "Müşteriyi kaydet", "Görevi ekle", "Değişiklikleri kaydet" telefonda "Kaydet" olur
 * (eski çubukta "Portföyü o… 3 eksik" diye kesiliyordu). Kayıt anlamı taşımayan ya da birleşik eylemler ("Onaya gönder",
 * "Kodu doğrula ve kaydet", "Geri al") olduğu gibi kalır; düğme tam genişlikte olduğundan kırpılmaz.
 */
const SAVE_VERBS = new Set(["kaydet", "oluştur", "ekle", "güncelle"]);

export function mobileSubmitLabel(label: string): string {
  const words = label.trim().split(/\s+/);
  if (words.length <= 1) return label.trim();
  if (words.some((w) => w.toLocaleLowerCase("tr-TR") === "ve")) return label.trim();
  const last = words[words.length - 1]!.toLocaleLowerCase("tr-TR");
  return SAVE_VERBS.has(last) ? "Kaydet" : label.trim();
}
