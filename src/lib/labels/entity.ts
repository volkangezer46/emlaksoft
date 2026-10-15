/**
 * Kayıt türü etiket sözlüğü (B191) — denetim izi / ofis kontrolü / kayıt ekranının TEK haritası. `entity_type` ham kodu
 * (task, customer_demand …) ekranda ASLA gösterilmez: bilinen tür Türkçe adıyla, bilinmeyen tür "Kayıt" olarak görünür.
 * Terimler `src/lib/terms.ts` ile uyumludur (ofisin kendi kaydı "Portföy", anlaşma "Anlaşma"). Saf modül.
 */

type EntityLabel = { one: string; many: string };

const LABELS: Readonly<Record<string, EntityLabel>> = {
  customer: { one: "Müşteri", many: "Müşteriler" },
  customers: { one: "Müşteri listesi", many: "Müşteri listeleri" },
  musteriler: { one: "Müşteri listesi", many: "Müşteri listeleri" },
  property: { one: "Portföy", many: "Portföyler" },
  properties: { one: "Portföy listesi", many: "Portföy listeleri" },
  demand: { one: "Talep", many: "Talepler" },
  customer_demand: { one: "Talep", many: "Talepler" },
  deal: { one: "Anlaşma", many: "Anlaşmalar" },
  offer: { one: "Teklif", many: "Teklifler" },
  contract: { one: "Sözleşme", many: "Sözleşmeler" },
  commission: { one: "Komisyon", many: "Komisyonlar" },
  appointment: { one: "Randevu", many: "Randevular" },
  booking_settings: { one: "Randevu bağlantısı ayarı", many: "Randevu bağlantısı ayarları" },
  task: { one: "Görev", many: "Görevler" },
  tasks: { one: "Görev listesi", many: "Görev listeleri" },
  call: { one: "Arama", many: "Aramalar" },
  approval_request: { one: "Onay talebi", many: "Onay talepleri" },
  support_ticket: { one: "Destek talebi", many: "Destek talepleri" },
  tenant: { one: "Ofis ayarı", many: "Ofis ayarları" },
  profile: { one: "Kullanıcı", many: "Kullanıcılar" },
  team_member: { one: "Ekip üyesi", many: "Ekip üyeleri" },
  presentation: { one: "Sunum", many: "Sunumlar" },
  valuation: { one: "Değerleme", many: "Değerlemeler" },
  survey: { one: "Anket", many: "Anketler" },
  referral: { one: "Tavsiye", many: "Tavsiyeler" },
  referral_link: { one: "Davet bağlantısı", many: "Davet bağlantıları" },
  project_unit: { one: "Proje birimi", many: "Proje birimleri" },
  cash_entry: { one: "Kasa hareketi", many: "Kasa hareketleri" },
  cash_transfer: { one: "Kasa virmanı", many: "Kasa virmanları" },
  recurring_rule: { one: "Düzenli ödeme", many: "Düzenli ödemeler" },
  finance_open_item: { one: "Açık kalem", many: "Açık kalemler" },
  expense: { one: "Gider", many: "Giderler" },
  rental: { one: "Kira sözleşmesi", many: "Kira sözleşmeleri" },
  automation: { one: "Otomasyon", many: "Otomasyonlar" },
};

/** Bilinmeyen tür için gösterilen ad. */
export const UNKNOWN_ENTITY_LABEL = "Kayıt";

/** Kayıt türünün tekil adı; bilinmeyen/boş tür "Kayıt". */
export function entityLabel(type: string | null | undefined): string {
  return (type && LABELS[type]?.one) || UNKNOWN_ENTITY_LABEL;
}

/** Kayıt türünün çoğul adı; bilinmeyen/boş tür "Kayıtlar". */
export function entityLabelPlural(type: string | null | undefined): string {
  return (type && LABELS[type]?.many) || "Kayıtlar";
}

/** Sözlükte tanımlı türler (sözleşme testi ve filtre listeleri için). */
export const KNOWN_ENTITY_TYPES: readonly string[] = Object.keys(LABELS);
