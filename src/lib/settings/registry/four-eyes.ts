import type { AnySettingDef } from "../types";
import { defineBool, defineInt } from "./define";
import { FOUR_EYES_DEFAULTS, FOUR_EYES_KEYS } from "@/lib/platform-security/four-eyes-policy";

/**
 * DG1 dört göz onayı ayarları (platform kapsamı, `platform_settings` deposu; Ayar merkezi > Güvenlik). Hepsi varsayılan
 * KAPALI: açılınca ilgili kritik işlem yürümez, Kontrol paneli > Onaylar kuyruğuna düşer ve başka bir yetkili onaylar.
 * Yalnız süper admin değiştirir (personel modülü). SINIR: ayarın kendisi tek imzayla kapatılabilir (dört göze bağlı
 * değil); kapatma/eşik değişikliği Ayar merkezi denetim izine düşer. Bu, impact metinlerinde açıkça yazılıdır.
 */
// B116: `home` YOK: eşikler Ayar merkezi > Güvenlik'te SettingField olarak düzenlenir (Onaylar sayfası yalnız kuyruktur;
// eskiden home=/admin/onaylar olduğu için "Düzenle →" Onaylar'a gidiyor, orada da form olmadığından döngüsel çıkmaz oluyordu).
const PERM = { platformModule: "personel", superAdminOnly: true } as const;

export const FOUR_EYES_SETTING_DEFS: AnySettingDef[] = [
  defineInt({
    key: FOUR_EYES_KEYS.refundThreshold,
    permission: PERM,
    default: FOUR_EYES_DEFAULTS.refundThresholdTry,
    min: 0,
    max: 999999,
    unit: "TL",
    category: "guvenlik",
    label: "Dört göz: iade eşiği",
    description: "Bu tutar ve üstündeki iade kaydı ikinci bir yetkilinin onayına düşer. 0 = kapalı (iade tek imzayla yürür).",
    impact:
      "Açıkken eşik üstü iade, başka bir onay yetkilisi Onaylar kuyruğundan onaylayana dek yazılmaz. Tek süper admin varsa onay verilemez. Eşik tek süper admin tarafından değiştirilebilir (denetim izine düşer).",
    risk: "high",
  }),
  defineInt({
    key: FOUR_EYES_KEYS.creditThreshold,
    permission: PERM,
    default: FOUR_EYES_DEFAULTS.creditThresholdTry,
    min: 0,
    max: 999999,
    unit: "TL",
    category: "guvenlik",
    label: "Dört göz: hesap kredisi eşiği",
    description: "Bu tutar ve üstündeki TL hesap kredisi yüklemesi ikinci onaya düşer. 0 = kapalı.",
    impact: "Açıkken eşik üstü kredi, başka bir onay yetkilisi onaylayana dek ofise yüklenmez.",
    risk: "high",
  }),
  defineBool({
    key: FOUR_EYES_KEYS.officeClose,
    permission: PERM,
    default: FOUR_EYES_DEFAULTS.officeClose,
    category: "guvenlik",
    label: "Dört göz: ofis askıya alma ve arşivleme",
    description:
      "Açıkken ofisi askıya alma ya da arşivleme (Ofis 360 > Yönetim) ikinci bir yetkilinin onayıyla yürür. Toplu işlem, abonelik konsolu ve ofis sahibinin kapatma talebi ofisi tek imzayla kapatamaz.",
    impact:
      "Acil askıya alma da onay bekler; onaylayan yoksa ofis açık kalır. Ayarın kendisi tek süper admin tarafından kapatılabilir (denetim izine düşer).",
    risk: "high",
  }),
  defineBool({
    key: FOUR_EYES_KEYS.staffRole,
    permission: PERM,
    default: FOUR_EYES_DEFAULTS.staffRole,
    category: "guvenlik",
    label: "Dört göz: personel rol değişikliği",
    description:
      "Açıkken personelin rolü (sabit ya da özel rol) ikinci bir yetkilinin onayıyla değişir. Süper admin doğrudan eklenemez, pasif personel farklı rolle yeniden açılamaz.",
    impact:
      "Ayar açıkken yetki yükseltme tek kişiyle yapılamaz; rol değişikliği onaylanana dek eski rol geçerlidir. Sınır: ayarın kendisi tek süper admin tarafından kapatılabilir (denetim izine düşer).",
    risk: "high",
  }),
  defineInt({
    key: FOUR_EYES_KEYS.expiryHours,
    permission: PERM,
    default: FOUR_EYES_DEFAULTS.expiryHours,
    min: 1,
    max: 720,
    unit: "saat",
    category: "guvenlik",
    label: "Dört göz: talep geçerlilik süresi",
    description: "Onay bekleyen talep bu süre içinde karara bağlanmazsa düşer; işlem yeniden başlatılır.",
    impact: "Kısa süre eski taleplerin sonradan onaylanmasını önler; çok kısa süre onaylayanı aceleye getirir.",
  }),
];
