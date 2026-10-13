import type { AnySettingDef } from "../types";
import { defineBool, defineInt } from "./define";

/** Ayarların düzenlendiği bölüm: Destek talepleri > Ayarlar > Otomasyon (merkez buraya bağlantı verir). */
export const SUPPORT_HOME = { href: "/admin/tickets/ayarlar?sekme=otomasyon", label: "Destek talepleri > Ayarlar" } as const;

/** Ayarlar ekranındaki SLA/atama yazımıyla aynı kapı (support-desk.ts DESK_MANAGER_ROLES): okuma tickets, yazma süper admin + operasyon. */
const SUPPORT_PERMISSION = { platformModule: "tickets", superAdminOnly: false, platformRoles: ["super_admin", "ops"] } as const;

/**
 * DESTEK MASASI ayarları (AD9; platform kapsamı, `platform_settings` deposu). SLA matrisi, iş saatleri ve atama
 * kuralları tablo olarak tutulur (support_* tabloları); burada yalnız aç/kapa ve gün eşikleri vardır.
 * `support.auto_assign_enabled` veritabanı tetikleyicisi tarafından da okunur (yoksa açık).
 */
export const SUPPORT_SETTING_DEFS: AnySettingDef[] = [
  defineBool({
    key: "support.auto_assign_enabled",
    home: SUPPORT_HOME,
    permission: SUPPORT_PERMISSION,
    default: true,
    category: "cron",
    label: "Yeni destek talebini otomatik ata",
    description:
      "Yeni talep, kategorisine uyan atama kuralına göre sıradaki uygun personele atanır (sıralı dağıtım). İzinli veya pasif personel atlanır; uygun kimse yoksa talep kuyrukta kalır.",
    impact: "Kapatılırsa yeni talepler atanmadan kuyruğa düşer ve elle atanır; mevcut atamalar değişmez.",
  }),
  defineBool({
    key: "support.waiting_automation_enabled",
    home: SUPPORT_HOME,
    permission: SUPPORT_PERMISSION,
    default: false,
    category: "cron",
    label: "Yanıt bekleyen talepleri hatırlat ve kapat",
    description:
      "Müşteri yanıtı beklenen talepte son personel yanıtından belirli gün sonra müşteriye hatırlatma gider; daha uzun süre yanıt gelmezse talep otomatik kapatılır. Gecikme kontrolüyle (5 dakikada bir) birlikte çalışır.",
    impact:
      "Açılırsa eşikleri geçen 'Yanıt bekliyor' talepler kapanır ve müşteri bildirimi alır. Kapalıyken hiçbir talep otomatik kapanmaz.",
    risk: "high",
  }),
  defineInt({
    key: "support.waiting_reminder_days",
    home: SUPPORT_HOME,
    permission: SUPPORT_PERMISSION,
    default: 3,
    min: 0,
    max: 60,
    unit: "gün",
    category: "cron",
    label: "Hatırlatma (gün)",
    description:
      "Son personel yanıtından bu kadar gün sonra müşteri yanıt vermediyse talebe hatırlatma mesajı eklenir ve bildirim gider. 0 = hatırlatma yok.",
    impact: "Kısaltılırsa müşteriler daha erken hatırlatma alır; her yanıt döngüsünde en fazla bir hatırlatma gider.",
  }),
  defineInt({
    key: "support.waiting_autoclose_days",
    home: SUPPORT_HOME,
    permission: SUPPORT_PERMISSION,
    default: 7,
    min: 0,
    max: 120,
    unit: "gün",
    category: "cron",
    label: "Otomatik kapanış (gün)",
    description:
      "Son personel yanıtından bu kadar gün sonra hâlâ müşteri yanıtı yoksa talep 'yanıt gelmedi' çözüm koduyla kapatılır. 0 = otomatik kapanış yok.",
    impact: "Kısaltılırsa yanıt bekleyen talepler daha erken kapanır; müşteri talebi her zaman yeniden açabilir.",
    risk: "high",
  }),
  defineBool({
    key: "support.reply_email_enabled",
    home: SUPPORT_HOME,
    permission: SUPPORT_PERMISSION,
    default: false,
    category: "bildirim",
    label: "Destek yanıtını müşteriye e-postayla gönder",
    description:
      "Personelin müşteriye görünür yanıtı, talebi açan kullanıcıya e-posta olarak da gider. E-posta kanalı (Ayarlar > E-posta) kapalıysa gönderim yapılmaz ve 'kanal kapalı' olarak günlüğe düşer.",
    impact: "Açılırsa her müşteri yanıtı e-postayla da iletilir; uygulama içi bildirim her durumda sürer.",
  }),
];

export const SUPPORT_SETTING_KEYS = SUPPORT_SETTING_DEFS.map((d) => d.key);
