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
    id: "davet",
    label: "Davet",
    description: "Hesabın nasıl teslim edileceği.",
    fields: ["invite_mode"],
    required: ["invite_mode"],
  },
] as const;

/** Taslağa yalnız hassas olmayan, kontrolsüz alanlar (telefon/e-posta/ad YOK). */
export const ADVISOR_DRAFT_FIELDS = ["title", "branch_id"] as const;

export const INVITE_MODES = ["email", "password"] as const;
export type InviteMode = (typeof INVITE_MODES)[number];
