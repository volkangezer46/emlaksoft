import type { AnySettingDef } from "../types";
import { DEFAULT_TV_CONFIG, formatTvConfig } from "@/lib/tv/tv-logic";
import { defineJson } from "./define";

/**
 * Ofis Panosu (TV) yayın ayarı — ofis kapsamı, `tenant_settings`, KÖPRÜ ayarı: yalnız Pano TV'deki ayar çekmecesinden
 * yazılır (`saveTvConfigAction`, `settings:edit` + TV rolü). İçerik `parseTvConfig` ile güvenle çözülür (sahne sırası,
 * açık/kapalı, süre, tema, para göster, gece modu). Okuyucu: `loadTvData` (oturumlu pano ve eşleşmiş TV cihazları aynı
 * değeri alır). Varsayılan = bugünkü davranış: bütün sahneler açık, koyu tema, para KAPALI.
 */
export const TV_CONFIG_KEY = "office.tv.config";

export const TV_SETTING_DEFS: AnySettingDef[] = [
  defineJson({
    scope: "tenant",
    storage: "tenant_settings",
    permission: { appModule: "settings" },
    category: "gorunum",
    key: TV_CONFIG_KEY,
    default: formatTvConfig(DEFAULT_TV_CONFIG),
    editMode: "bridge",
    editHref: "/app/pano-tv",
    home: { href: "/app/pano-tv", label: "Pano TV" },
    label: "Ofis TV yayını",
    description: "Ofis TV'sinde dönen sahnelerin sırası, süreleri, tema, gece modu ve tutarların gösterilip gösterilmeyeceği.",
    impact:
      "Ofisin bütün TV ekranları (oturumlu pano ve eşleşmiş cihazlar) bir sonraki yenilemede yeni düzeni alır. Tutarlar açılsa bile yalnız tüm kazançları görme izni olan oturumda görünür; eşleşmiş cihazda hiçbir zaman gösterilmez.",
  }),
];
