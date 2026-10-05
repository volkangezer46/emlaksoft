/**
 * Ofis tipi şablonları (kurulum sihirbazı) — saf veri, istemci/sunucu ikisi de import edebilir.
 *
 * Şablon, ofisin odağına göre ofise ÖZEL tanım ekler (global tanımlar korunur, var olan değer atlanır):
 * kayıp nedenleri ve müşteri kaynakları. Kod dallanması olan sistem değerlerine dokunmaz
 * (bkz. definition-defaults SYSTEM_DEFINITION_VALUES). Demo paketi anahtarı `sample_pack` ile aynıdır.
 */

export type OfficeTemplateKey = "konut" | "arsa" | "ticari";

export type OfficeTemplate = {
  key: OfficeTemplateKey;
  label: string;
  description: string;
  /** Eklenecek kayıp nedenleri (value = etiket; "|" içermez). */
  lossReasons: readonly string[];
  /** Eklenecek müşteri kaynakları. */
  customerSources: readonly { value: string; label: string }[];
};

export const OFFICE_TEMPLATES: readonly OfficeTemplate[] = [
  {
    key: "konut",
    label: "Konut odaklı",
    description: "Daire, villa ve kiralık konut ağırlıklı ofisler.",
    lossReasons: ["Kredi onayı çıkmadı", "Aidat/yan gider yüksek bulundu", "Kat/cephe beğenilmedi", "Tapu/iskân sorunu"],
    customerSources: [
      { value: "site_ziyareti", label: "Site/bina ziyareti" },
      { value: "mahalle_tanitim", label: "Mahalle tanıtımı" },
    ],
  },
  {
    key: "arsa",
    label: "Arsa / tarla odaklı",
    description: "Arsa, tarla ve yatırım amaçlı arazi satan ofisler.",
    lossReasons: ["İmar durumu uygun değil", "Tapu/ifraz sorunu", "Yola cephe/ulaşım yetersiz", "Hisseli tapu çekincesi"],
    customerSources: [
      { value: "yatirim_semineri", label: "Yatırım semineri" },
      { value: "arazi_grubu", label: "Arazi/yatırım grubu" },
    ],
  },
  {
    key: "ticari",
    label: "Ticari / iş yeri odaklı",
    description: "Dükkan, ofis, depo ve ticari gayrimenkul ofisleri.",
    lossReasons: ["Kira çarpanı beklentiyi karşılamadı", "Cephe/konum yetersiz", "Stopaj/KDV maliyeti yüksek", "Kullanım izni (iskân) uygun değil"],
    customerSources: [
      { value: "esnaf_cevresi", label: "Esnaf çevresi" },
      { value: "zincir_marka", label: "Zincir marka/franchise" },
    ],
  },
];

export function isOfficeTemplateKey(v: unknown): v is OfficeTemplateKey {
  return OFFICE_TEMPLATES.some((t) => t.key === v);
}

export function getOfficeTemplate(key: OfficeTemplateKey): OfficeTemplate {
  return OFFICE_TEMPLATES.find((t) => t.key === key) ?? OFFICE_TEMPLATES[0];
}
