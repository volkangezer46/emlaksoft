/**
 * Anlaşma kapanış dosyası — varsayılan evrak şablonları.
 *
 * Türkiye pratiğine göre satış ve kiralama kapanışında istenen tipik evraklar.
 * "Şablondan oluştur" bu listeyi anlaşmaya toplu madde olarak kopyalar;
 * ofis sonrasında serbestçe ekler/siler (şablon bağlayıcı değil, başlangıç).
 *
 * `required: false` maddeler duruma bağlı evraklardır (vekaletname yalnız
 * vekaletle işlemde, kefil evrakı yalnız kefilli kirada gerekir) — yüzde
 * hesabına girmezler ama listede hatırlatıcı olarak dururlar.
 */

export type ChecklistTemplateItem = { label: string; required: boolean };

/** Satış kapanışı evrakları (deal_type = "sale"). */
export const SALE_CHECKLIST: ChecklistTemplateItem[] = [
  { label: "Tapu fotokopisi", required: true },
  { label: "Satıcı kimlik fotokopisi", required: true },
  { label: "Alıcı kimlik fotokopisi", required: true },
  { label: "DASK poliçesi", required: true },
  { label: "Belediye rayiç bedel yazısı", required: true },
  { label: "İpotek/haciz durum belgesi (takyidat)", required: true },
  { label: "Enerji kimlik belgesi", required: true },
  { label: "Vekaletname (vekaletle işlemde)", required: false },
  { label: "İskan belgesi (yapı kullanma izni)", required: false },
];

/** Kiralama kapanışı evrakları (deal_type = "rent"). */
export const RENT_CHECKLIST: ChecklistTemplateItem[] = [
  { label: "Kiracı kimlik fotokopisi", required: true },
  { label: "Mal sahibi kimlik fotokopisi", required: true },
  { label: "Kira sözleşmesi (imzalı)", required: true },
  { label: "DASK poliçesi", required: true },
  { label: "Tahliye taahhütnamesi", required: true },
  { label: "Demirbaş listesi (teslim tutanağı)", required: true },
  { label: "Kefil kimlik ve gelir belgesi (kefilli işlemde)", required: false },
  { label: "Kiracı gelir belgesi", required: false },
];

/** Anlaşmanın işlem türüne uyan şablonu döndürür. */
export function templateForDealType(dealType: string): ChecklistTemplateItem[] {
  return dealType === "rent" ? RENT_CHECKLIST : SALE_CHECKLIST;
}
