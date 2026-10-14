import type { AppModule } from "@/lib/permissions";

/**
 * Yetki modüllerinin Türkçe adları (TEK kaynak; saf modül: sunucu ve istemci bileşeni birlikte okur).
 * Roller/yetkilendirme matrisi, erişim denetleyicisi ve Bugün ekranındaki "Bu sayfa rolünüz için kapalı" şeridi kullanır.
 */
export const MODULE_LABELS: Record<AppModule, string> = {
  dashboard:   "Ana ekran",
  customers:   "Müşteriler",
  demands:     "Talepler",
  properties:  "Portföyler",
  matching:    "Eşleştirme",
  portals:     "Portal kontrol",
  leak:        "Kayıp-kaçak",
  appointments:"Randevular",
  calls:       "Akıllı arama",
  commissions: "Komisyon / Anlaşmalar",
  tasks:       "Görevler",
  team:        "Ekip",
  support:     "Destek",
  settings:    "Ayarlar",
  billing:     "Abonelik",
  reports:     "Raporlar",
  valuation:   "Değerleme",
  compliance:  "Uyum",
  campaigns:   "Kampanyalar",
  contracts:   "Sözleşmeler",
  expenses:    "Muhasebe",
  offers:      "Teklifler",
  targets:     "Hedefler",
  open_house:  "Açık Ev",
  rentals:     "Mülk yönetimi",
  projects:    "Proje Satış",
  network:     "Ofisler Arası Ağ",
  surveys:     "Anketler ve anketör",
  earnings_all: "Başkasının kazancı (yalnız Görüntüle)",
  office_center: "Ofis Merkezi",
  prospecting: "Sahibinden ilanlar",
};

/** `?sayfa=<modül>` değerini güvenle etikete çevirir; bilinmeyen değer null (şerit modül adı olmadan gösterilir). */
export function moduleLabelFor(value: string | null | undefined): string | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(MODULE_LABELS, value) ? MODULE_LABELS[value as AppModule] : null;
}
