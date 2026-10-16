import type { AnySettingDef } from "../types";
import { defineJson } from "./define";

/**
 * MENÜ YÖNETİMİ (platform kapsamı, `platform_settings` deposu, tek JSON değer). Köprü ayar: yalnız Yönetim > Menü
 * yönetimi ekranından yazılır (`saveNavMenuOverrides`: doğrulama + varsayılanla sadeleştirme orada; süper admin + hız
 * sınırı; değer + geçmiş + denetim izi ayar defterinin tek yolundan). Değer SEYREK farktır (`src/lib/nav-overrides.ts`):
 * ofis paneli düzenlerinde gizle / sırala / yeniden adlandır / grup gizle, admin menüsünde grup gizle / sırala.
 * Boş = koddaki varsayılan menüler (`src/lib/nav-roles.ts`, `src/lib/admin/nav.ts`).
 */
export const NAV_MENU_OVERRIDES_KEY = "platform.nav_menu_overrides";
export const NAV_MENU_HOME = { href: "/admin/ayarlar/menu", label: "Yönetim > Menü yönetimi" } as const;

export const NAV_MENU_SETTING_DEFS: AnySettingDef[] = [
  defineJson({
    key: NAV_MENU_OVERRIDES_KEY,
    home: NAV_MENU_HOME,
    editHref: NAV_MENU_HOME.href,
    default: "",
    category: "gorunum",
    label: "Panel menüleri (rol bazlı düzen)",
    description: "Ofis paneli yan menüsünde rol bazında görünen satırlar, alt sayfalar, sıra ve adlar; admin menüsünde grupların sırası ve görünürlüğü.",
    impact:
      "Kaydedince ofislerde en geç 30 saniye içinde yeni menü görünür. Yalnız görünürlük değişir: yetki ve paket kuralları aynen geçerlidir, gizlenen sayfa adresle ve Ctrl K aramasıyla açılmaya devam eder.",
  }),
];
