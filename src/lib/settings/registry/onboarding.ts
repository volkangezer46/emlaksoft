import type { AnySettingDef } from "../types";
import { defineJson } from "./define";

/**
 * ÜRÜN TURU ve KURULUM KONTROL LİSTESİ içeriği (SN5; platform kapsamı, `platform_settings` deposu, tek JSON değer).
 * Köprü ayar: yalnız Ofisler > Kurulum > İçerik düzenleyicisinden yazılır (doğrulama + varsayılanla sadeleştirme orada);
 * merkez bu ayarı o ekrana bağlantı olarak gösterir. Boş = koddaki turlar ve adımlar (`src/lib/onboarding-content.ts`).
 */
export const ONBOARDING_CONTENT_KEY = "onboarding.content";
export const ONBOARDING_CONTENT_HOME = { href: "/admin/tenants/kurulum?sekme=icerik", label: "Ofisler > Kurulum > İçerik" } as const;

export const ONBOARDING_SETTING_DEFS: AnySettingDef[] = [
  defineJson({
    key: ONBOARDING_CONTENT_KEY,
    home: ONBOARDING_CONTENT_HOME,
    editHref: ONBOARDING_CONTENT_HOME.href,
    default: "",
    category: "gorunum",
    label: "Ürün turu ve kurulum adımları",
    description: "Ofis panelindeki tanıtım turlarının adımları ve kurulum sihirbazının adım metinleri, sırası, açık/kapalı durumu ve rol/paket hedeflemesi.",
    impact: "Kaydedince ofislerde en geç 30 saniye içinde yeni metin ve sıra görünür; boş bırakılan kısım koddaki varsayılanla çalışır.",
    permission: { platformModule: "tenants", platformRoles: ["super_admin", "ops"] },
  }),
];
