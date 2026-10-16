import { cache } from "react";
import { getSetting } from "@/lib/settings/read";
import { NAV_MENU_OVERRIDES_KEY } from "@/lib/settings/registry/nav-menu";
import { EMPTY_MENU_OVERRIDES, parseMenuOverrides, type MenuOverrides } from "@/lib/nav-overrides";

/**
 * Menü yönetimi farkının SUNUCU okuyucusu (ayar defteri platform anlık görüntüsü: 30 sn önbellek, yazımda etiket
 * tazelenir; istek içinde tek okuma). Okuma hatası ya da bozuk değer = boş fark → koddaki varsayılan menüler (asla fırlatmaz).
 */
export const loadMenuOverrides = cache(async (): Promise<MenuOverrides> => {
  try {
    return parseMenuOverrides(await getSetting<string>(NAV_MENU_OVERRIDES_KEY));
  } catch {
    return EMPTY_MENU_OVERRIDES;
  }
});
