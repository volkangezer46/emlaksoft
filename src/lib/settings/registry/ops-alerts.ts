import type { AnySettingDef } from "../types";
import { defineBool, defineInt } from "./define";

/**
 * OPERASYON VE UYARI MERKEZİ ayarları (AD10; platform kapsamı, `platform_settings` deposu). Kural bazlı eşik, tekrar
 * aralığı ve sessize alma `alert_rules` tablosundadır (Sistem > Uyarılar); burada yalnız motorun genel anahtarı ve
 * saklama süreleri vardır. Dış kanallar (Telegram/e-posta/webhook) kanal eklenene kadar KAPALIDIR (sahte gönderim yok).
 */
export const OPS_ALERTS_HOME = { href: "/admin/sistem?sekme=uyarilar#ayarlar", label: "Sistem > Uyarılar" } as const;

export const OPS_ALERT_SETTING_KEYS = {
  engineEnabled: "ops.alerts.engine_enabled",
  cronRunsRetentionDays: "ops.alerts.cron_runs_retention_days",
  hostMetricsRetentionDays: "ops.alerts.host_metrics_retention_days",
  eventRetentionDays: "ops.alerts.event_retention_days",
} as const;

export const OPS_ALERT_SETTING_DEFS: AnySettingDef[] = [
  defineBool({
    key: OPS_ALERT_SETTING_KEYS.engineEnabled,
    home: OPS_ALERTS_HOME,
    default: true,
    category: "saglik",
    label: "Uyarı motoru açık",
    description:
      "Cron gecikmesi/hatası, hata patlaması, yedek, disk, ödeme yakalama ve MRR kuralları 5 dakikada bir değerlendirilir. Site kesintisi uyarısı sunucu betiğindedir ve bu anahtardan etkilenmez.",
    impact: "Kapatılırsa uygulama içi kurallar değerlendirilmez ve bildirim gitmez; açık olaylar olduğu gibi kalır.",
    risk: "high",
  }),
  defineInt({
    key: OPS_ALERT_SETTING_KEYS.cronRunsRetentionDays,
    home: OPS_ALERTS_HOME,
    default: 30,
    min: 7,
    max: 180,
    category: "saglik",
    label: "Cron çalışma geçmişi saklama (gün)",
    description: "Cron çalışma geçmişi (süre, sonuç, ayrıntı) bu süreden eski satırlar saatlik budamada silinir.",
    impact: "Kısaltmak süre grafiğindeki geçmişi azaltır; uzatmak tabloyu büyütür (iş başına günde en çok 720 satır).",
  }),
  defineInt({
    key: OPS_ALERT_SETTING_KEYS.hostMetricsRetentionDays,
    home: OPS_ALERTS_HOME,
    default: 14,
    min: 1,
    max: 90,
    category: "saglik",
    label: "Sunucu ölçümü saklama (gün)",
    description: "Disk/RAM/yük ölçümleri (dakikada bir satır) bu süreden sonra silinir.",
    impact: "Kaynaklar sekmesindeki eğrinin geriye gidebileceği en uzun süredir.",
  }),
  defineInt({
    key: OPS_ALERT_SETTING_KEYS.eventRetentionDays,
    home: OPS_ALERTS_HOME,
    default: 90,
    min: 7,
    max: 730,
    category: "saglik",
    label: "Düzelen uyarı saklama (gün)",
    description: "Düzelmiş uyarı olayları ve teslim günlükleri bu süreden sonra silinir; açık olaylar silinmez.",
    impact: "Uyarı geçmişinin ne kadar geriye görüneceğini belirler.",
  }),
];
