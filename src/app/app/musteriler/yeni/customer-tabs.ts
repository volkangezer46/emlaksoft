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
    description: "Ad soyad zorunlu; telefon yazılırken ofisteki aynı kişi uyarılır. Tür ve şube sonradan değiştirilebilir.",
    fields: ["full_name", "phone", "type", "branch_id"],
    required: ["full_name"],
  },
  {
    id: "iletisim",
    label: "E-posta ve bölge",
    description: "İlçe, bölge bazlı raporlama ve filtreleme için kullanılır.",
    fields: ["email", "province_id", "district_id"],
    required: [],
  },
  {
    // Alan adları talep formuyla TEK kaynak (demand-criteria.ts); alanlar StructuredDemandFields ortak bileşeninde.
    id: "talep",
    label: "Talep ve kriterler",
    description: "Alıcı/kiracı için aradığı portföy: bütçe, oda, bölge ve olmazsa olmaz kriterler. Eşleştirme bunları kullanır.",
    fields: [...DEMAND_FIELD_GROUPS.ne, ...DEMAND_FIELD_GROUPS.kriter, ...DEMAND_FIELD_GROUPS.bolge],
    required: [],
    // Bu üçü hazır seçili gelir (Satılık / Daire / Normal); doldurulmamış sekmeye yeşil tik vermesin.
    passive: ["transaction_type", "property_type", "urgency"],
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

type CustomerTab = (typeof CUSTOMER_TABS)[number];
export type CustomerFormTab = Omit<CustomerTab, "fields" | "label" | "description"> & {
  label: string;
  description?: string;
  fields: readonly string[];
  /** Sade görünüm: kapalı "Daha fazla bilgi" bölümü (layout="single"). */
  collapsible?: boolean;
};

/**
 * DENGELİ GÖRÜNÜM (sadeleştirme planı C11, sahip kararı 2026-10-16): ilk ekranda ad soyad, telefon, tür ve sık kullanılan
 * e-posta (4 giriş alanı); şube kişi bölümünden "Daha fazla bilgi" bölümüne iner, diğer bölümler kapalı katlanır. Alan kümesi `CUSTOMER_TABS` ile AYNIDIR
 * (yalnız yerleşim değişir; sözleşme testi tam düzeni denetler, bu düzen ondan türetilir).
 */
export const CUSTOMER_TABS_SIMPLE: readonly CustomerFormTab[] = CUSTOMER_TABS.map((t): CustomerFormTab => {
  if (t.id === "kisi") return { ...t, description: undefined, fields: [...t.fields.filter((f) => f !== "branch_id"), "email"] };
  if (t.id === "iletisim") {
    return { ...t, label: "Daha fazla bilgi: şube ve bölge", description: undefined, fields: ["branch_id", ...t.fields.filter((f) => f !== "email")], collapsible: true };
  }
  if (t.id === "talep") return { ...t, label: "Ne arıyor? (bütçe, oda, bölge)", description: undefined, collapsible: true };
  return { ...t, description: undefined, collapsible: true };
});
