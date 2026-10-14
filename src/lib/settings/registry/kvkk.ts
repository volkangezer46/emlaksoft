import type { AnySettingDef } from "../types";
import { defineBool } from "./define";

/** Ayarların düzenlendiği bölüm: Destek talepleri > Ayarlar > KVKK. */
export const KVKK_HOME = { href: "/admin/tickets/ayarlar?sekme=kvkk", label: "Destek talepleri > Ayarlar > KVKK" } as const;

/** Destek ayarlarıyla aynı kapı: okuma tickets, yazma süper admin + operasyon. */
const KVKK_PERMISSION = { platformModule: "tickets", superAdminOnly: false, platformRoles: ["super_admin", "ops"] } as const;

export const KVKK_SETTING_KEYS = {
  publicFormEnabled: "kvkk.public_form_enabled",
} as const;

/**
 * KVKK VERİ SAHİBİ BAŞVURULARI (DG6; platform kapsamı, `platform_settings` deposu). Yasal yanıt süresi (30 gün) kanundan
 * gelir ve ayar DEĞİLDİR; süre uyarısının eşiği AD10 uyarı kuralındadır (Sistem > Uyarılar > "KVKK başvuru süresi").
 */
export const KVKK_SETTING_DEFS: AnySettingDef[] = [
  defineBool({
    key: KVKK_SETTING_KEYS.publicFormEnabled,
    home: KVKK_HOME,
    permission: KVKK_PERMISSION,
    default: true,
    category: "uyum",
    label: "KVKK başvuru formu açık",
    description:
      "/kvkk-basvuru sayfasındaki herkese açık başvuru formu. Başvuru e-posta doğrulama koduyla tamamlanır ve Destek > KVKK talepleri > Doğrudan başvurular kuyruğuna düşer.",
    impact:
      "Kapatılırsa form yerine destek e-posta adresi gösterilir; yeni başvuru alınmaz (KVKK m.13 başvuru kanalı sağlama yükümlülüğü için e-posta kanalı açık kalmalıdır). Kuyruktaki başvurular etkilenmez.",
    risk: "high",
  }),
];
