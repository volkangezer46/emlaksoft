import type { AnySettingDef } from "../types";
import { defineBool, defineEnum } from "./define";

/**
 * DEMO VERİSİ (DM1; platform kapsamı, `platform_settings`). Yeni ofis kaydında tam örnek ofis (müşteri, portföy + fotoğraf,
 * anlaşma, kira, demo ekip...) yüklensin mi ve varsayılan paket hangisi. Kayıt sihirbazında odak seçildiyse onun paketi
 * kullanılır; seçilmediyse bu varsayılan. Ofis 360 > Demo verisi ve /admin/demo-verisi bu ayarları gösterir.
 */
export const DEMO_SETTING_KEYS = {
  autoSeed: "demo.auto_seed_new_offices",
  defaultPack: "demo.default_pack",
} as const;

const PERM = { platformModule: "tenants", platformRoles: ["super_admin"] } as const;

export const DEMO_SETTING_DEFS: AnySettingDef[] = [
  defineBool({
    key: DEMO_SETTING_KEYS.autoSeed,
    default: true,
    category: "kayit-bakim",
    label: "Yeni ofislere demo verisi",
    description: "Kendi kendine kaydolan her yeni ofis, gerçek kullanıma geçene dek tam dolu örnek ofisle (fotoğraflı portföyler, anlaşmalar, ekip) açılır.",
    impact: "Kapatınca yalnız bundan sonraki kayıtlar boş ofisle açılır; mevcut ofislerin verisi değişmez.",
    permission: PERM,
  }),
  defineEnum({
    key: DEMO_SETTING_KEYS.defaultPack,
    default: "konut",
    options: [
      { value: "konut", label: "Konut ağırlıklı" },
      { value: "ticari", label: "Ticari ağırlıklı" },
      { value: "arsa", label: "Arsa ağırlıklı" },
    ],
    category: "kayit-bakim",
    label: "Varsayılan demo paketi",
    description: "Kayıtta çalışma odağı seçilmediğinde yüklenen örnek ofis paketi.",
    impact: "Yalnız bundan sonraki kayıtları etkiler.",
    permission: PERM,
  }),
];
