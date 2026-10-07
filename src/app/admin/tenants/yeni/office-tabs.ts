/**
 * Platform yönetiminden "Yeni ofis" formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 *
 * Taslak YOK: sahip e-postası/telefonu ve erişim seçimi localStorage'a yazılamaz; form taslak kullanmaz.
 * Geçici parola formda hiç yer almaz (sunucuda üretilir, sonuç ekranında bir kez gösterilir).
 */
export const OFFICE_FORM_ID = "yeni-ofis";

export const OFFICE_CREATE_TABS = [
  {
    id: "ofis",
    label: "Ofis bilgileri",
    description: "Ofisin adı, vitrin adresi ve iletişim bilgileri. Vitrin adresi ofis adından önerilir.",
    fields: ["office_name", "slug", "office_phone", "province_id", "district_id", "address_line", "license_no"],
    required: ["office_name"],
  },
  {
    id: "sahip",
    label: "Ofis sahibi",
    description: "Ofisin ilk kullanıcısı (sahip rolü). Giriş e-postası benzersiz olmalıdır.",
    fields: ["owner_name", "owner_email", "owner_phone", "access_mode"],
    required: ["owner_name", "owner_email"],
  },
  {
    id: "paket",
    label: "Paket ve deneme",
    description: "Paket ve ofisin başlangıç durumu. Deneme süresi platform kuralıdır, değiştirilemez.",
    fields: ["plan", "billing_cycle", "initial_status"],
    required: ["plan"],
  },
  {
    id: "fatura",
    label: "Fatura profili",
    description: "Faturada kullanılacak vergi bilgileri. Unvan olarak ofis adı, adres olarak ofis adresi kullanılır.",
    fields: ["tax_office", "tax_number"],
    required: [],
  },
  {
    id: "baslangic",
    label: "Başlangıç verisi",
    description: "Ofis boş mu açılsın, yoksa tanıtım amaçlı örnek kayıtlarla mı?",
    fields: ["seed_sample"],
    required: [],
  },
] as const;

export type OfficeCreateTabId = (typeof OFFICE_CREATE_TABS)[number]["id"];

/** Taslağa yazılabilen alan yok (kişisel veri ve erişim seçimi içerir). */
export const OFFICE_DRAFT_FIELDS = [] as const;

/** Sunucunun döndürdüğü hatalı alanın hangi sekmede olduğu (hata mesajına sekme adı eklemek için). */
export function tabLabelForField(field: string | null | undefined): string | null {
  if (!field) return null;
  const tab = OFFICE_CREATE_TABS.find((t) => (t.fields as readonly string[]).includes(field));
  return tab?.label ?? null;
}
