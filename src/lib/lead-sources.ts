/** Müşteri kaynak seçenekleri — client ve server tarafında kullanılabilir */
export const LEAD_SOURCES = [
  { value: "portal_sahibinden", label: "Sahibinden.com" },
  { value: "portal_hepsiemlak", label: "Hepsiemlak" },
  { value: "portal_zingat",     label: "Zingat" },
  { value: "portal_emlakjet",   label: "Emlak Jet" },
  { value: "tavsiye",           label: "Tavsiye / Referans" },
  { value: "sosyal_medya",      label: "Sosyal Medya" },
  { value: "web_sitesi",        label: "Web Sitesi" },
  { value: "telefon",           label: "Telefon" },
  { value: "ofis_ziyareti",     label: "Ofis Ziyareti" },
  { value: "diger",             label: "Diğer" },
] as const;

export type LeadSource = typeof LEAD_SOURCES[number]["value"];
