import type { AnySettingDef } from "../types";
import { defineBool, defineInt } from "./define";
import { HEALTH_DEFAULT_RISK_THRESHOLD, HEALTH_DEFAULT_WEIGHTS } from "@/lib/admin/health-score";

/**
 * OFİS CRM ayarları (AD5; platform kapsamı, `platform_settings` deposu). Ofis sağlık skoru ağırlıkları ve riskli eşiği.
 * Ayar merkezinde (/admin/ayarlar, "Sağlık ve izleme") düzenlenir; skor günlük hesaplandığı için değişiklik
 * ERTESİ hesaplamaya yansır (geçmiş günler yeniden yazılmaz). Ağırlıkların toplamı 0 olursa varsayılanlara dönülür.
 */
const CRM_PERMISSION = { platformModule: "tenants", superAdminOnly: true } as const;

export const CRM_SETTING_KEYS = {
  weightUsage: "crm.health_weight_usage",
  weightPayment: "crm.health_weight_payment",
  weightSupport: "crm.health_weight_support",
  riskThreshold: "crm.health_risk_threshold",
  playbooksEnabled: "crm.playbooks_enabled",
  playbookDropPoints: "crm.playbook_drop_points",
  nudgesEnabled: "crm.lifecycle_nudges_enabled",
} as const;

export const CRM_SETTING_DEFS: AnySettingDef[] = [
  defineInt({
    key: CRM_SETTING_KEYS.weightUsage,
    default: HEALTH_DEFAULT_WEIGHTS.usage,
    min: 0,
    max: 100,
    unit: "%",
    category: "saglik",
    permission: CRM_PERMISSION,
    label: "Sağlık skoru: kullanım ağırlığı",
    description: "Ofis sağlık skorunda kullanımın payı (giriş sıklığı, koltuk doluluğu, modül benimseme).",
    impact: "Ertesi günlük hesaplamadan itibaren skorlar yeni ağırlıkla hesaplanır; riskli ofis listesi buna göre değişir.",
  }),
  defineInt({
    key: CRM_SETTING_KEYS.weightPayment,
    default: HEALTH_DEFAULT_WEIGHTS.payment,
    min: 0,
    max: 100,
    unit: "%",
    category: "saglik",
    permission: CRM_PERMISSION,
    label: "Sağlık skoru: ödeme ağırlığı",
    description: "Ofis sağlık skorunda ödeme düzeninin payı (gecikmiş durum, vadesi geçmiş fatura).",
    impact: "Ertesi günlük hesaplamadan itibaren skorlar yeni ağırlıkla hesaplanır; riskli ofis listesi buna göre değişir.",
  }),
  defineInt({
    key: CRM_SETTING_KEYS.weightSupport,
    default: HEALTH_DEFAULT_WEIGHTS.support,
    min: 0,
    max: 100,
    unit: "%",
    category: "saglik",
    permission: CRM_PERMISSION,
    label: "Sağlık skoru: destek ağırlığı",
    description: "Ofis sağlık skorunda destek deneyiminin payı (açık talep sayısı, memnuniyet puanı).",
    impact: "Ertesi günlük hesaplamadan itibaren skorlar yeni ağırlıkla hesaplanır; riskli ofis listesi buna göre değişir.",
  }),
  defineInt({
    key: CRM_SETTING_KEYS.riskThreshold,
    default: HEALTH_DEFAULT_RISK_THRESHOLD,
    min: 1,
    max: 99,
    category: "saglik",
    permission: CRM_PERMISSION,
    label: "Sağlık skoru: riskli eşiği",
    description: "Bu değerin altındaki sağlık skoru 'riskli' sayılır; kontrol panelindeki riskli ofisler kartına düşer.",
    impact: "Eşik yükselirse daha çok ofis riskli listesine girer; değişiklik en geç 30 sn içinde panoya yansır.",
  }),
  defineBool({
    key: CRM_SETTING_KEYS.playbooksEnabled,
    default: true,
    category: "saglik",
    permission: CRM_PERMISSION,
    label: "Müşteri başarısı oyun kitapları",
    description:
      "Açıkken sağlık skoru düşüşü, riskli eşiğin altına iniş, NPS kötüleyen yanıtı, düşük destek puanı, iptal talebi ve kurulumu başlamamış deneme ofisi için sorumlu personele otomatik görev açılır (Ofisler > Görevler).",
    impact: "Kapatılırsa yeni otomatik görev açılmaz; açık görevler ve elle görevler etkilenmez.",
  }),
  defineInt({
    key: CRM_SETTING_KEYS.playbookDropPoints,
    default: 15,
    min: 5,
    max: 50,
    unit: "puan",
    category: "saglik",
    permission: CRM_PERMISSION,
    label: "Oyun kitabı: sağlık düşüşü eşiği",
    description: "Sağlık skoru son 7 günde en az bu kadar puan düşen ofis için görev açılır.",
    impact: "Eşik düşerse daha çok ofis için görev açılır; değişiklik bir sonraki 2 saatlik turda uygulanır.",
  }),
  defineBool({
    key: CRM_SETTING_KEYS.nudgesEnabled,
    default: true,
    category: "saglik",
    permission: CRM_PERMISSION,
    label: "Aktivasyon hatırlatmaları (uygulama içi + e-posta)",
    description:
      "Açıkken yeni ofislere kurulumda eksik kalan adım için 1., 3. ve 7. günde hatırlatma, deneme bitmeden değer özeti ve deneme bittikten 7 gün sonra geri kazanım e-postası gider. Metinler E-posta > Şablonlar > Aktivasyon ve geri kazanım bölümünden düzenlenir.",
    impact: "Kapatılırsa bir sonraki günlük turdan itibaren hiçbir hatırlatma gitmez; gönderim geçmişi korunur.",
  }),
];
