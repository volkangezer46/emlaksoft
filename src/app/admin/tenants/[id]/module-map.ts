/**
 * audit_logs.action önekini ürün modülüne eşler (kullanım analitiği için).
 *
 * Önekler koddaki gerçek `logActivity` action'larından çıkarıldı
 * (`action.split(".")[0]`). Bilinmeyen önekler "Diğer"e düşer — yeni bir modül
 * loglamaya başlarsa burada eşlenmediği sürece kaybolmaz, "Diğer"de görünür.
 */
export const MODULE_PREFIX_MAP: Record<string, string> = {
  // Müşteri omurgası
  customer: "Müşteriler",
  customer_file: "Müşteriler",
  kvkk: "Müşteriler",
  call: "Müşteriler",
  // Talep / eşleştirme
  lead: "Talepler",
  demand: "Talepler",
  match: "Talepler",
  // Portföy
  property: "Portföyler",
  property_media: "Portföyler",
  share: "Portföyler",
  portal: "Portföyler",
  // Satış süreci
  deal: "Anlaşmalar",
  offer: "Anlaşmalar",
  task: "Görevler",
  appointment: "Randevular",
  commission: "Komisyon",
  payment_link: "Komisyon",
  contract: "Sözleşmeler",
  rental: "Kiralama",
  // Pazarlama / otomasyon
  campaign: "Kampanyalar",
  iys: "Kampanyalar",
  automation: "Otomasyon",
  workflow: "Otomasyon",
  // Diğer modüller
  valuation: "Değerleme",
  project: "Projeler",
  project_unit: "Projeler",
  unit_payment: "Projeler",
  network: "Ofis ağı",
  settings: "Ayarlar",
  integration: "Ayarlar",
};

/**
 * Benimseme/ısı ölçümünde her zaman gösterilen çekirdek modüller — hiç kaydı
 * olmayan modül de "hiç kullanılmadı" olarak görünür kalır. "Ayarlar" ve
 * "Diğer" bilinçli olarak dışarıda: ürün değeri taşıyan modüller ölçülür.
 */
export const CORE_MODULES = [
  "Müşteriler",
  "Talepler",
  "Portföyler",
  "Anlaşmalar",
  "Görevler",
  "Randevular",
  "Komisyon",
  "Sözleşmeler",
  "Kiralama",
  "Kampanyalar",
  "Otomasyon",
  "Değerleme",
  "Projeler",
  "Ofis ağı",
] as const;

/** "customer.create" → "Müşteriler"; eşleşmeyen önek → "Diğer". */
export function moduleForAction(action: string): string {
  const prefix = action.split(".")[0] ?? "";
  return MODULE_PREFIX_MAP[prefix] ?? "Diğer";
}
