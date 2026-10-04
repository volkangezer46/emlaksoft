/**
 * Yeni danışman formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const ADVISOR_FORM_ID = "yeni-danisman";

export const ADVISOR_TABS = [
  {
    id: "kimlik",
    label: "Kimlik",
    description: "Ad soyad, iletişim ve unvan.",
    fields: ["full_name", "phone", "email", "title"],
    required: ["full_name", "email", "title"],
  },
  {
    id: "yetki",
    label: "Rol ve yetki",
    description: "Rolü seçin; o rolün etkin izinleri canlı görünür.",
    fields: ["role"],
    required: ["role"],
  },
  {
    id: "atama",
    label: "Atama ve kapsam",
    description: "Şube, veri görünürlüğü ve otomatik talep dağıtımı.",
    fields: ["branch_id"],
    required: [],
  },
  {
    id: "hedef",
    label: "Hedefler",
    description: "Bu ayın anlaşma ve ciro hedefi (isteğe bağlı).",
    fields: ["target_deals", "target_revenue"],
    required: [],
  },
  {
    id: "kisisel",
    label: "Kimlik ve kişisel",
    description: "TC kimlik, doğum tarihi, adres, acil durum kişisi ve banka bilgisi (yalnız ofis sahibi ve genel müdür görür).",
    fields: [
      "national_id",
      "birth_date",
      "address_line",
      "private_province_id",
      "private_district_id",
      "emergency_name",
      "emergency_relation",
      "emergency_phone",
      "bank_name",
      "iban_holder",
      "iban",
    ],
    required: [],
  },
  {
    id: "istihdam",
    label: "İstihdam ve belgeler",
    description: "İşe giriş, yetki belgeleri, kapasite, çalışma günleri ve havuz katılımı.",
    fields: [
      "employment_type",
      "hired_at",
      "left_at",
      "authority_cert_no",
      "authority_cert_expires_on",
      "spk_cert_no",
      "spk_cert_expires_on",
      "max_active_listings",
      "max_active_demands",
      "work_days",
      "work_start",
      "work_end",
      "accepts_pool",
      "pool_paused_until",
    ],
    required: [],
  },
  {
    id: "uzmanlik",
    label: "Uzmanlık",
    description: "Portföy türü ve segment, işlem türü, seviye ve fiyat bandı.",
    fields: ["specialties_json"],
    required: [],
  },
  {
    id: "bolge",
    label: "Bölgeler",
    description: "Uzman olduğu il, ilçe ve mahalleler; ağırlık 1-5.",
    fields: ["regions_json"],
    required: [],
  },
  {
    id: "davet",
    label: "Davet",
    description: "Hesabın nasıl teslim edileceği.",
    fields: ["invite_mode"],
    required: ["invite_mode"],
  },
] as const;

/** Sekme id -> ek profil özelliği (şema/yetki yokken yalnız bu sekmeler gizlenir; mevcut form aynen çalışır). */
export type AdvisorExtraFeature = "private" | "work" | "specialty";
export const ADVISOR_EXTRA_TABS: Record<string, AdvisorExtraFeature> = {
  kisisel: "private",
  istihdam: "work",
  uzmanlik: "specialty",
  bolge: "specialty",
};

/** Yeni danışman akışında hesap açıldıktan sonra `saveAdvisorExtras`'a giden (createAdvisor'a GİTMEYEN) alan adları. */
export const ADVISOR_EXTRA_FIELD_NAMES: ReadonlySet<string> = new Set(
  ADVISOR_TABS.filter((t) => t.id in ADVISOR_EXTRA_TABS).flatMap((t) => [...t.fields]),
);

/** Taslağa yalnız hassas olmayan, kontrolsüz alanlar (telefon/e-posta/ad YOK). */
export const ADVISOR_DRAFT_FIELDS = ["title", "branch_id"] as const;

export const INVITE_MODES = ["email", "password"] as const;
export type InviteMode = (typeof INVITE_MODES)[number];
