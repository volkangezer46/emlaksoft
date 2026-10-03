/**
 * Yeni platform personeli formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 *
 * Taslak YOK: geçici parola ve e-posta localStorage'a yazılamaz; form taslak kullanmaz.
 */
export const STAFF_FORM_ID = "yeni-platform-personeli";

export const STAFF_TABS = [
  {
    id: "kimlik",
    label: "Kimlik",
    description: "Personelin adı ve giriş e-postası. Kayıtlı bir hesap varsa doğrudan bağlanır.",
    fields: ["full_name", "email"],
    required: ["full_name", "email"],
  },
  {
    id: "guvenlik",
    label: "Güvenlik",
    description: "İsteğe bağlı geçici parola. Boş bırakırsanız davet e-postası gönderilir.",
    fields: ["temp_password"],
    required: [],
  },
  {
    id: "rol",
    label: "Rol ve erişim",
    description: "Departman rolü hangi platform ekranlarına erişileceğini belirler.",
    fields: ["role"],
    required: ["role"],
  },
] as const;

/** Taslağa yazılabilen alan yok (parola/e-posta hassas; ad soyad da yazılmaz). */
export const STAFF_DRAFT_FIELDS = [] as const;
