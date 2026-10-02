/**
 * TANIM LİSTELERİNİN TEK SABİT KAYNAĞI.
 *
 * `definitions` tablosu canlı kaynaktır (src/lib/definitions.ts getDefinitions).
 * Bu dosyadaki listeler yalnız (a) tablo boş/erişilemezken fallback ve
 * (b) kodun dallandığı SİSTEM anahtarlarının kilit listesi içindir.
 * Başka dosyada aynı listeyi çoğaltma; sözleşme testi
 * (definition-single-source-contract.test.ts) bunu yakalar.
 * Dosya client/server ikisinde de güvenle import edilebilir (sunucu bağımlılığı yok).
 */

export const DEFINITION_CATEGORIES = [
  { key: "customer_type", label: "Müşteri tipi" },
  { key: "customer_source", label: "Müşteri kaynağı" },
  { key: "property_type", label: "Portföy tipi" },
  { key: "transaction_type", label: "İşlem tipi" },
  { key: "contract_type", label: "Sözleşme tipi" },
  { key: "expense_category", label: "Gider kategorisi" },
  { key: "appointment_type", label: "Randevu tipi" },
  { key: "demand_urgency", label: "Talep aciliyeti" },
  { key: "ticket_category", label: "Destek kategorisi" },
] as const;

export type DefinitionCategory = (typeof DEFINITION_CATEGORIES)[number]["key"];

export const DEFINITION_CATEGORY_KEYS: readonly DefinitionCategory[] = DEFINITION_CATEGORIES.map((c) => c.key);

export function isDefinitionCategory(v: string): v is DefinitionCategory {
  return (DEFINITION_CATEGORY_KEYS as readonly string[]).includes(v);
}

export type DefaultDefinition = { value: string; label: string };

/** Müşteri formunun son dönemde yazdığı kaynak değerleri (customers.source'ta bulunabilir). */
export const LEAD_SOURCES = [
  { value: "portal_sahibinden", label: "Sahibinden.com" },
  { value: "portal_hepsiemlak", label: "Hepsiemlak" },
  { value: "portal_zingat", label: "Zingat" },
  { value: "portal_emlakjet", label: "Emlak Jet" },
  { value: "tavsiye", label: "Tavsiye / Referans" },
  { value: "sosyal_medya", label: "Sosyal Medya" },
  { value: "web_sitesi", label: "Web Sitesi" },
  { value: "telefon", label: "Telefon" },
  { value: "ofis_ziyareti", label: "Ofis Ziyareti" },
  { value: "diger", label: "Diğer" },
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number]["value"];

/** Gider kategorileri (expenses.category text). */
export const EXPENSE_CATEGORIES = [
  { value: "reklam", label: "Reklam & Pazarlama" },
  { value: "ofis", label: "Ofis Giderleri" },
  { value: "ulasim", label: "Ulaşım" },
  { value: "egitim", label: "Eğitim & Gelişim" },
  { value: "komisyon_gider", label: "Komisyon Gideri" },
  { value: "diger", label: "Diğer" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

/** Eski kayıtlarda bulunabilen işlem tipi değerleri (dropdown'da mevcut değer kaybolmasın). */
export const LEGACY_TRANSACTION_TYPE_VALUES = ["sale", "rent"] as const;

/** Varsayılan seed/fallback — migration 042-044 global satırlarıyla birebir. */
export const DEFAULT_DEFINITIONS: Record<DefinitionCategory, readonly DefaultDefinition[]> = {
  customer_type: ["Alıcı", "Satıcı", "Kiracı", "Mülk sahibi", "Yatırımcı"].map((v) => ({ value: v, label: v })),
  customer_source: [
    { value: "referral", label: "Referans" },
    { value: "web", label: "Web sitesi" },
    { value: "social", label: "Sosyal medya" },
    { value: "walk_in", label: "Elden geldi" },
    { value: "phone", label: "Telefon" },
    { value: "portal", label: "Portal" },
    { value: "other", label: "Diğer" },
  ],
  property_type: ["Daire", "Villa", "Müstakil ev", "Arsa", "İşyeri", "Dükkan", "Ofis", "Depo", "Bina"].map((v) => ({ value: v, label: v })),
  transaction_type: ["Satılık", "Kiralık"].map((v) => ({ value: v, label: v })),
  contract_type: [
    { value: "satis", label: "Satış" },
    { value: "kira", label: "Kira" },
    { value: "sozlesme", label: "Sözleşme" },
    { value: "teklif", label: "Teklif" },
    { value: "diger", label: "Diğer" },
  ],
  expense_category: EXPENSE_CATEGORIES,
  appointment_type: [
    { value: "showing", label: "Yer gösterme" },
    { value: "valuation", label: "Değerleme" },
    { value: "office", label: "Ofis görüşmesi" },
    { value: "signing", label: "İmza / sözleşme" },
    { value: "other", label: "Diğer" },
  ],
  demand_urgency: [
    { value: "low", label: "Düşük" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "Yüksek" },
    { value: "urgent", label: "Acil" },
  ],
  ticket_category: [
    { value: "general", label: "Genel" },
    { value: "billing", label: "Abonelik / fatura" },
    { value: "bug", label: "Hata bildirimi" },
    { value: "feature", label: "Özellik isteği" },
    { value: "compliance", label: "İYS / KVKK" },
    { value: "onboarding", label: "Kurulum" },
  ],
};

/**
 * SİSTEM ANAHTARLARI: kodun / DB CHECK kısıtlarının dallandığı değerler.
 * Bunlar silinemez ve pasifleştirilemez (etiket/renk/sıra değişebilir).
 * definitions tablosunda is_system kolonu olmadığı için kilit kod tarafındadır.
 */
export const SYSTEM_DEFINITION_VALUES: Record<DefinitionCategory, readonly string[]> = {
  customer_type: [],
  customer_source: ["referral", "other"], // tavsiye modülü customers.source='referral' yazar
  property_type: [],
  transaction_type: ["Satılık", "Kiralık"], // portföy/talep eşleşmesi ve vitrin bu değerlere dallanır
  contract_type: ["satis", "kira", "sozlesme", "teklif", "diger"], // contract_type enum'u
  expense_category: ["diger"],
  appointment_type: ["showing", "valuation", "office", "signing", "other"], // appointments CHECK + rapor sayaçları
  demand_urgency: ["low", "normal", "high", "urgent"], // talep skorlaması
  ticket_category: ["general"], // varsayılan destek kategorisi
};

export function isSystemDefinitionValue(category: string, value: string): boolean {
  if (!isDefinitionCategory(category)) return false;
  return SYSTEM_DEFINITION_VALUES[category].includes(value);
}

export function defaultDefinitionValues(category: DefinitionCategory): string[] {
  return DEFAULT_DEFINITIONS[category].map((d) => d.value);
}

/** value → label haritası (fallback + LEAD_SOURCES eski/yeni kaynak etiketleri). */
export function defaultLabelMap(category: DefinitionCategory): Record<string, string> {
  const base: Record<string, string> = Object.fromEntries(DEFAULT_DEFINITIONS[category].map((d) => [d.value, d.label]));
  if (category === "customer_source") {
    for (const s of LEAD_SOURCES) base[s.value] = s.label;
  }
  return base;
}
