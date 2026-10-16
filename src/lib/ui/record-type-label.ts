/**
 * Üst çubuk konum satırında ayrıntı sayfasının KAYIT TÜRÜ ("Müşteriler › Müşteri" — eskiden her yerde "Ayrıntı").
 * Liste yolunun ilk bölümünden tekil Türkçe ad; tanınmayan yolda "Ayrıntı" (SAF; vitest).
 */
const RECORD_TYPE: Record<string, string> = {
  musteriler: "Müşteri",
  portfoyler: "Portföy",
  talepler: "Talep",
  anlasmalar: "Anlaşma",
  randevular: "Randevu",
  gorevler: "Görev",
  kiralama: "Kira sözleşmesi",
  ekip: "Ekip üyesi",
  teklifler: "Teklif",
  sozlesmeler: "Sözleşme",
  projeler: "Proje",
  "acik-ev": "Açık ev",
  kampanyalar: "Kampanya",
  "portfoy-avi": "Sahibinden ilan",
  onaylar: "Onay talebi",
  destek: "Destek talebi",
  otomasyonlar: "Otomasyon",
};

export function recordTypeLabel(baseHref: string): string {
  const seg = baseHref.split("?")[0]!.replace(/^\/app\/?/, "").split("/")[0] ?? "";
  return RECORD_TYPE[seg] ?? "Ayrıntı";
}
