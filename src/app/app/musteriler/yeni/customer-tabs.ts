/**
 * Yeni müşteri formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır. Yeni alan eklersen
 * hem formda hem burada (fields) olmalı; sözleşme testi eşitliği doğrular.
 */
import { DEMAND_FIELD_GROUPS } from "@/lib/demand-criteria";

export const CUSTOMER_FORM_ID = "yeni-musteri";

export const CUSTOMER_TABS = [
  {
    id: "kisi",
    label: "Kişi",
    description: "Ad soyad zorunludur; müşteri türü ve şube sonradan değiştirilebilir.",
    fields: ["full_name", "type", "branch_id"],
    required: ["full_name"],
  },
  {
    id: "iletisim",
    label: "İletişim ve bölge",
    description: "İlçe, bölge bazlı raporlama ve filtreleme için kullanılır.",
    fields: ["phone", "email", "province_id", "district_id"],
    required: [],
  },
  {
    // Alan adları talep formuyla TEK kaynak (demand-criteria.ts); alanlar StructuredDemandFields ortak bileşeninde.
    id: "talep",
    label: "Talep ve kriterler",
    description: "Alıcı/kiracı için aradığı portföy: bütçe, oda, bölge ve olmazsa olmaz kriterler. Eşleştirme bunları kullanır.",
    fields: [...DEMAND_FIELD_GROUPS.ne, ...DEMAND_FIELD_GROUPS.kriter, ...DEMAND_FIELD_GROUPS.bolge],
    required: [],
  },
  {
    id: "ozel-gunler",
    label: "Özel günler",
    description: "Doğum günü ve yıldönümü hatırlatmaları için.",
    fields: ["birth_date", "anniversary_date", "anniversary_note"],
    required: [],
  },
  {
    id: "not",
    label: "Not",
    description: "Serbest not. Talep ve bütçe gibi eşleştirilecek bilgileri \"Talep ve kriterler\" sekmesine girin.",
    fields: ["notes"],
    required: [],
  },
] as const;

/** Taslağa yazılabilen alanlar: yalnız hassas olmayan seçimler (telefon/e-posta/not/ad YOK). */
export const CUSTOMER_DRAFT_FIELDS = ["type", "branch_id"] as const;
