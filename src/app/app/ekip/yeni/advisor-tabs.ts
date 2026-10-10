/**
 * Yeni danışman formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 */
export const ADVISOR_FORM_ID = "yeni-danisman";

export const ADVISOR_TABS = [
  {
    id: "kimlik",
    label: "Kimlik ve rol",
    description: "Ad soyad, iletişim, unvan, rol ve şube. Kimlik, belge ve hedef bilgileri danışman detayında sonra doldurulur.",
    fields: ["full_name", "phone", "email", "title", "role", "branch_id"],
    required: ["full_name", "email", "title", "role"],
  },
  {
    id: "uzmanlik",
    label: "Uzmanlık ve bölge",
    description: "Hangi tür ilanlarda ve hangi bölgelerde uzman? Talep ve ilan dağıtımı buna göre öneri üretir (isteğe bağlı).",
    fields: ["specialties_json", "regions_json"],
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

/** Sekme id -> ek profil özelliği (şema/yetki yokken yalnız bu sekme gizlenir; mevcut form aynen çalışır). */
export type AdvisorExtraFeature = "specialty";
export const ADVISOR_EXTRA_TABS: Record<string, AdvisorExtraFeature> = {
  uzmanlik: "specialty",
};

/** Yeni danışman akışında hesap açıldıktan sonra `saveAdvisorExtras`'a giden (createAdvisor'a GİTMEYEN) alan adları. */
export const ADVISOR_EXTRA_FIELD_NAMES: ReadonlySet<string> = new Set(
  ADVISOR_TABS.filter((t) => t.id in ADVISOR_EXTRA_TABS).flatMap((t) => [...t.fields]),
);

/** Taslağa yalnız hassas olmayan, kontrolsüz alanlar (telefon/e-posta/ad YOK). */
export const ADVISOR_DRAFT_FIELDS = ["title", "branch_id"] as const;

export const INVITE_MODES = ["email", "password"] as const;
export type InviteMode = (typeof INVITE_MODES)[number];
