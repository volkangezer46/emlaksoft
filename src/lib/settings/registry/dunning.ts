import type { AnySettingDef } from "../types";
import { defineEnum, defineInt, defineString } from "./define";

/**
 * DUNNING (gecikmiş ödeme tahsilat politikası) ayarları — platform kapsamı, `platform_settings` deposu.
 * Tek düzenleme yeri: Abonelik & fatura > Tahsilat sekmesi (`/admin/billing/tahsilat#ayarlar`). Okuyucu:
 * `src/lib/billing/dunning-policy.ts` (cron + otomatik yenileme). Varsayılanlar BUGÜNKÜ davranıştır:
 * kademeler 1/4/8 gün, yalnız uygulama içi bildirim, otomatik askıya alma KAPALI (0), otomatik yenileme 3 deneme / 3 gün.
 */
export const DUNNING_HOME = { href: "/admin/billing/tahsilat#ayarlar", label: "Abonelik & fatura > Tahsilat" } as const;

export const DUNNING_CHANNEL_OPTIONS = [
  { value: "in_app", label: "Yalnız uygulama içi" },
  { value: "in_app_email", label: "Uygulama içi + e-posta" },
  { value: "in_app_sms", label: "Uygulama içi + SMS" },
  { value: "in_app_email_sms", label: "Uygulama içi + e-posta + SMS" },
] as const;

const TEMPLATE_HELP =
  "Boş bırakılırsa yerleşik metin kullanılır. Değişkenler: {ofis} ofis adı, {fatura} fatura no, {gun} gecikme günü, {odeme_linki} ödeme sayfası, {kart_linki} kart güncelleme bağlantısı.";

function stageDefs(n: 1 | 2 | 3, defaultDays: number): AnySettingDef[] {
  return [
    defineInt({
      key: `dunning.stage${n}_days`,
      home: DUNNING_HOME,
      default: defaultDays,
      min: 1,
      max: 90,
      unit: "gün",
      category: "faturalama",
      label: `Tahsilat ${n}. kademe günü`,
      description: `Fatura vadesinden kaç gün sonra ${n}. hatırlatma kademesinin gönderileceği. Kademeler küçükten büyüğe sıralanır.`,
      impact:
        "Günlük tahsilat taraması (dunning) bu güne ulaşan ödenmemiş faturalar için ilgili kademe bildirimini gönderir; her kademe fatura başına bir kez gider.",
    }),
    defineEnum({
      key: `dunning.stage${n}_channels`,
      home: DUNNING_HOME,
      default: "in_app",
      options: DUNNING_CHANNEL_OPTIONS,
      category: "faturalama",
      label: `Tahsilat ${n}. kademe kanalı`,
      description: `${n}. kademe hatırlatmasının hangi kanallardan gideceği. Uygulama içi bildirim her zaman gider.`,
      impact:
        "E-posta için Resend anahtarı + gönderen, SMS için platform Netgsm hesabı tanımlı olmalıdır; tanımlı değilse o kanal atlanır ve tahsilat günlüğüne 'kanal kapalı' yazılır (sahte gönderim yok).",
    }),
    defineString({
      key: `dunning.stage${n}_template`,
      home: DUNNING_HOME,
      default: "",
      maxLength: 600,
      multiline: true,
      category: "faturalama",
      label: `Tahsilat ${n}. kademe mesajı`,
      description: TEMPLATE_HELP,
      impact: "Bu kademenin bildirim, e-posta ve SMS gövdesi bu metinle yazılır. Değişiklik bir sonraki günlük taramada geçerli olur.",
    }),
  ];
}

export const DUNNING_SETTING_DEFS: AnySettingDef[] = [
  ...stageDefs(1, 1),
  ...stageDefs(2, 4),
  ...stageDefs(3, 8),
  defineInt({
    key: "dunning.auto_suspend_days",
    home: DUNNING_HOME,
    default: 0,
    min: 0,
    max: 120,
    unit: "gün",
    category: "faturalama",
    label: "Otomatik askıya alma günü",
    description:
      "Fatura vadesinden kaç gün sonra hâlâ ödenmemiş ofisin otomatik askıya alınacağı. 0 = kapalı (yalnız personele 'askıya alma adayı' bildirimi gider).",
    impact:
      "Açılırsa bu güne ulaşan ödenmemiş ofis askıya alınır (panel yalnız Abonelik ekranına açılır; ödeme gelince ofis yeniden aktif olur) ve platform denetim kaydına 'tenant.suspend' düşer.",
    risk: "high",
  }),
  defineInt({
    key: "dunning.final_warning_days",
    home: DUNNING_HOME,
    default: 2,
    min: 0,
    max: 30,
    unit: "gün",
    category: "faturalama",
    label: "Askıdan önce son uyarı",
    description:
      "Otomatik askıya almadan kaç gün önce ofise 'son uyarı' bildirimi gideceği (0 = son uyarı yok). Otomatik askı kapalıyken etkisizdir.",
    impact: "Son uyarı fatura başına bir kez, 3. kademe kanallarıyla gönderilir.",
  }),
  defineInt({
    key: "dunning.auto_renew_max_attempts",
    home: DUNNING_HOME,
    default: 3,
    min: 1,
    max: 10,
    category: "faturalama",
    label: "Otomatik yenileme deneme sayısı",
    description: "Saklı kartla otomatik tahsilatın 30 günlük pencerede en çok kaç kez deneneceği (otomatik yenileme bayrağı açıksa).",
    impact: "Sınıra ulaşan ofiste kart yeniden çekilmez; hatırlatma kademeleri sürer.",
  }),
  defineInt({
    key: "dunning.auto_renew_retry_gap_days",
    home: DUNNING_HOME,
    default: 3,
    min: 1,
    max: 30,
    unit: "gün",
    category: "faturalama",
    label: "Otomatik yenileme deneme aralığı",
    description: "İki otomatik tahsilat denemesi arasında beklenecek en az gün.",
    impact: "Kısaltmak başarısız kart çekimlerini sıklaştırır; sağlayıcı ret oranını artırabilir.",
  }),
];
