import type { AnySettingDef } from "../types";
import { defineBool, defineInt } from "./define";

/**
 * EİDS AKSİYON MOTORU ayarları (EP4; ofis kapsamı, `tenant_settings` deposu, Ayarlar > Ofis tanımları > Uyum).
 * Sahip kararı varsayılanları: iptal/süre bitiminde EmlakSoft vitrini ve paylaşım bağlantıları otomatik kapanır (geri
 * alınabilir); açık kaldırma görevi 48 saatte ofis sahibine yükselir.
 */
const TENANT = {
  scope: "tenant",
  storage: "tenant_settings",
  permission: { appModule: "settings" },
  category: "bayrak",
} as const;

export const EIDS_ACTION_SETTING_KEYS = {
  autoHidePublic: "eids.auto_hide_public",
  escalationHours: "eids.takedown_escalation_hours",
} as const;

export const EIDS_ACTION_SETTING_DEFS: AnySettingDef[] = [
  defineBool({
    ...TENANT,
    key: EIDS_ACTION_SETTING_KEYS.autoHidePublic,
    group: "uyum",
    default: true,
    label: "Yetki iptalinde vitrini ve paylaşım bağlantılarını otomatik kapat",
    description:
      "Malik EİDS yetkisini iptal ettiğinde ya da yetki süresi dolduğunda ilan EmlakSoft vitrininden kalkar ve portföyün paylaşım bağlantıları kapanır. Portallardaki ilanlar kaldırma görevindeki kontrol listesiyle elle (ya da eklentiyle) kaldırılır.",
    impact:
      "Kapalıyken vitrin ve paylaşım bağlantıları da kontrol listesine elle işaretlenecek kalem olarak düşer. Açıkken yapılan kapatma kontrol listesinden geri alınabilir.",
  }),
  defineInt({
    ...TENANT,
    key: EIDS_ACTION_SETTING_KEYS.escalationHours,
    group: "uyum",
    default: 48,
    min: 12,
    max: 168,
    label: "Kaldırma görevi yükseltme süresi",
    description: "Yetkisi iptal edilen ya da süresi dolan ilanın kaldırma görevi bu süre içinde kapanmazsa ofis sahibine yükseltme bildirimi gider (bir kez).",
    impact: "Kısaltmak ofis sahibini daha erken uyarır; görevin 3 günlük termini değişmez.",
    unit: "saat",
  }),
];
