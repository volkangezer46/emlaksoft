import {
  DEFAULT_TRIAL_DAYS,
  DEFAULT_TRIAL_GRACE_DAYS,
  MAX_MAINTENANCE_MESSAGE,
  MAX_TRIAL_DAYS,
  MAX_TRIAL_GRACE_DAYS,
  MIN_TRIAL_DAYS,
  MIN_TRIAL_GRACE_DAYS,
  PLATFORM_SETTING_KEYS,
} from "@/lib/platform-setting-keys";
import { TRY_DEFAULT_MAX_SHARE, TRY_MAX_SHARE_SETTING_KEY } from "@/lib/try-credits/constants";
import { parseMaxShare } from "@/lib/try-credits/config";
import { DEFAULT_LEAD_FORM_COPY } from "@/lib/legal-copy";
import { EMAIL_TEMPLATES, templateSettingKey } from "@/lib/email/templates";
import { z } from "zod";
import type { AnySettingDef } from "../types";
import { defineBool, defineInt, defineJson, defineNumber, defineSecret, defineString } from "./define";

/**
 * PLATFORM ayarlari. ILK DALGA KURALI: varsayilan = bugunku sabit (registry.test.ts kilitler), davranis degismez,
 * mevcut depolar (platform_settings) korunur, veri tasima YOK. `key` noktali ad; depo adi `storageKey`.
 */

const SUPER = { platformModule: "sistem", superAdminOnly: true } as const;

/** Konuya ait ayarların düzenlendiği bölüm sayfaları (merkez bunları bağlantı olarak gösterir). */
export const SYSTEM_HOME = { href: "/admin/sistem#ayarlar", label: "Sistem > Kayıt ve bakım" } as const;
export const BILLING_HOME = { href: "/admin/billing#ayarlar", label: "Abonelik & fatura > Ayarlar" } as const;

export const PORTAL_NAMES = ["sahibinden", "hepsiemlak", "zingat", "emlakjet"] as const;

const general: AnySettingDef[] = [
  defineBool({
    key: "platform.maintenance_mode",
    home: SYSTEM_HOME,
    storageKey: PLATFORM_SETTING_KEYS.maintenanceMode,
    legacyKeys: ["maintenance_mode"],
    default: false,
    category: "bayrak",
    label: "Bakım modu",
    description: "Açıkken ofis panelleri bakım ekranı gösterir.",
    impact: "Tüm ofis kullanıcıları bakım ekranını görür; yöneticiler etkilenmez. Kapatınca anında normale döner.",
    risk: "high",
    edge: true,
    cacheTags: ["settings:platform"],
  }),
  defineString({
    key: "platform.maintenance_message",
    home: SYSTEM_HOME,
    storageKey: PLATFORM_SETTING_KEYS.maintenanceMessage,
    legacyKeys: ["maintenance_message"],
    default: "",
    maxLength: MAX_MAINTENANCE_MESSAGE,
    multiline: true,
    category: "bayrak",
    label: "Bakım mesajı",
    description: "Bakım ekranında gösterilen kısa açıklama.",
    impact: "Yalnız bakım modu açıkken kullanıcıya görünür.",
    edge: true,
  }),
  defineBool({
    key: "platform.registration_open",
    home: SYSTEM_HOME,
    storageKey: PLATFORM_SETTING_KEYS.registrationOpen,
    legacyKeys: ["registration_open"],
    default: true,
    category: "bayrak",
    label: "Yeni kayıt açık",
    description: "Kapatıldığında yeni ofis kaydı alınmaz.",
    impact: "Kayıt sayfası ve signUp kapalı mesajı gösterir; mevcut hesaplar giriş yapabilir.",
    risk: "high",
    edge: true,
  }),
  defineInt({
    key: "billing.default_trial_days",
    home: BILLING_HOME,
    storageKey: PLATFORM_SETTING_KEYS.defaultTrialDays,
    legacyKeys: ["default_trial_days"],
    default: DEFAULT_TRIAL_DAYS,
    min: MIN_TRIAL_DAYS,
    max: MAX_TRIAL_DAYS,
    unit: "gün",
    category: "faturalama",
    label: "Varsayılan deneme süresi",
    description: "Yeni kayıt ve demo dönüşümünde uygulanan deneme günü.",
    impact: "Yalnız bundan sonra açılan denemeleri etkiler; sürmekte olan denemeler değişmez. SQL platform_default_trial_days() ayrıca korunur.",
  }),
  defineInt({
    key: "billing.trial_grace_days",
    home: BILLING_HOME,
    storageKey: PLATFORM_SETTING_KEYS.trialGraceDays,
    default: DEFAULT_TRIAL_GRACE_DAYS,
    min: MIN_TRIAL_GRACE_DAYS,
    max: MAX_TRIAL_GRACE_DAYS,
    unit: "gün",
    category: "faturalama",
    label: "Deneme sonrası tolerans",
    description: "Deneme bitip ödeme yapılmazsa ofis bu süre sonunda otomatik askıya alınır.",
    impact: "Süreyi kısaltmak, ödeme yapmamış ofislerin daha erken askıya alınmasına yol açar. Ödeme yapılınca askı kalkar.",
    risk: "high",
  }),
  defineBool({
    key: "billing.auto_renew_enabled",
    home: BILLING_HOME,
    default: false,
    truthy: "true-false",
    category: "faturalama",
    label: "Otomatik yenileme (kart)",
    description: "Kayıtlı karttan otomatik abonelik yenileme yönetici bayrağı. Kapalıyken ödeme kod yolu çalışmaz.",
    impact: "Açılırsa rıza veren ofislerin kartından yenileme tahsilatı denenir. Açmadan önce sözleşme ve rıza metni onaylanmalıdır.",
    risk: "high",
  }),
  defineBool({
    key: "billing.plan_change_proration_enabled",
    home: BILLING_HOME,
    default: false,
    category: "faturalama",
    label: "Oransal paket yükseltme / planlı düşürme",
    description: "Aktif ücretli abonelikte üst pakete kalan gün oranında fark faturasıyla geçiş; daha ucuz pakete geçiş dönem sonunda uygulanır (iade yok).",
    impact: "Açılırsa ofisler Paket & ödeme ekranında oransal yükseltme ve planlı düşürme görür; aktif aboneliğin tam fiyatlı paket değişimi kapanır. Önce 20261007001000 ve 20261007001010 migration'ları uygulanmalıdır; SQL de bu ayarı kontrol eder.",
    risk: "high",
  }),
  defineBool({
    key: "billing.pause_enabled",
    home: BILLING_HOME,
    default: false,
    category: "faturalama",
    label: "Abonelik duraklatma",
    description: "Ofis sahibi, aktif aboneliğini ayarlanan en çok gün kadar duraklatabilir (yılda 1 kez). Duraklatmada veri salt-okunur olur; dönem bitişi duraklatma süresi kadar uzar.",
    impact: "Açılırsa ofis sahipleri Paket & ödeme ekranında duraklatma görür. Duraklatılmış ofiste yazma işlemleri kapanır; faturalama ve gecikme kontrolleri durur. Önce 20261007001000 migration'ı uygulanmalıdır; SQL de bu ayarı kontrol eder.",
    risk: "high",
  }),
  defineInt({
    key: "billing.pause_max_days",
    home: BILLING_HOME,
    default: 30,
    min: 1,
    max: 90,
    unit: "gün",
    category: "faturalama",
    label: "Duraklatma azami süresi",
    description: "Bir duraklatmanın en uzun süresi (gün). Yılda en çok 1 duraklatma yapılabilir.",
    impact: "Yalnız bundan sonra başlayan duraklatmalara uygulanır; süren duraklatmalar planlanan bitişte devam eder.",
  }),
  defineNumber({
    key: "try_credit.max_invoice_share",
    home: BILLING_HOME,
    storageKey: TRY_MAX_SHARE_SETTING_KEY,
    default: TRY_DEFAULT_MAX_SHARE,
    min: 0.0001,
    max: 1,
    parse: parseMaxShare,
    category: "emlakfiyati",
    label: "TL kredinin fatura payı üst sınırı",
    description: "Tek faturada TL kredinin KDV dahil toplamdaki en yüksek payı (0-1). 1 = tam kredi ile ödeme açılır.",
    impact: "1 yapılırsa iyzico'suz tam kredi ödemesi mümkün olur. Değişiklik yeni faturalarda geçerlidir (önbellek 60 sn).",
    risk: "high",
    cacheTags: ["try-credit-config"],
  }),
];

/** Öğrenen eklenti kuralları (/admin/sistem?sekme=portal-kurallari). SQL `pt_rules_learn` aynı anahtarları okur. */
export const PORTAL_RULES_HOME = { href: "/admin/sistem?sekme=portal-kurallari", label: "Sistem > Portal kuralları" } as const;
const portalRules: AnySettingDef[] = [
  defineInt({
    key: "portal_rules.min_tenants",
    home: PORTAL_RULES_HOME,
    default: 3,
    min: 1,
    max: 10,
    unit: "ofis",
    category: "bayrak",
    label: "Portal kuralı: en az destekleyen ofis",
    description: "Bir eşleme önerisinin 'hazır' sayılması için onu doğrulayan en az uygun ofis sayısı (ofis başına tek oy).",
    impact: "Düşürmek, daha az ofisin gözlemiyle önerinin hazır olmasını sağlar; zehirleme riskini artırır. Otomatik yayın ayrıca kapalıdır.",
    risk: "high",
  }),
  defineInt({
    key: "portal_rules.min_sessions",
    home: PORTAL_RULES_HOME,
    default: 6,
    min: 1,
    max: 1000,
    unit: "oturum",
    category: "bayrak",
    label: "Portal kuralı: en az yayınlanmış oturum",
    description: "Bir önerinin hazır sayılması için destekleyen ofislerdeki doğrulanmış yayın oturumu toplamı.",
    impact: "Düşürmek önerilerin daha az kanıtla hazır olmasını sağlar.",
  }),
  defineBool({
    key: "portal_rules.auto_publish",
    home: PORTAL_RULES_HOME,
    default: false,
    category: "bayrak",
    label: "Portal kuralı: otomatik yayın",
    description: "Açıkken hazır ofis önerileri (AI önerileri hariç) gece öğrenme adımında imzalı yeni sürüm olarak yayınlanır.",
    impact: "Açılırsa yeni etiket/seçenek eşlemeleri personel onayı beklemeden tüm ofislerin eklentisine gider (sürüm başına en çok 5 değişiklik, personele bildirim).",
    risk: "high",
  }),
  defineBool({
    key: "portal_rules.auto_degrade",
    home: PORTAL_RULES_HOME,
    default: false,
    category: "bayrak",
    label: "Portal kuralı: otomatik geriletme",
    description: "Açıkken son 14 günde uygun ofislerde hata oranı %50'yi geçen alan 'kontrol edin' durumuna otomatik alınır (haftada en çok 3).",
    impact: "Açılırsa sorunlu alanlar eklentide uyarıyla doldurulur; uygun ofis sayısı az iken kapalı tutulmalıdır.",
    risk: "high",
  }),
  defineInt({
    key: "portal_rules.ai_min_tenants",
    home: PORTAL_RULES_HOME,
    default: 2,
    min: 1,
    max: 5,
    unit: "ofis",
    category: "ai",
    label: "Portal kuralı: AI girdisi için en az ofis",
    description: "AI önerisine yalnız bu kadar farklı ofiste görülmüş eşleşmemiş alanlar girer (alan metni k≥2 kuralıyla ayrıca sınırlı).",
    impact: "Yükseltmek AI'ya giden alan sayısını azaltır; 2'nin altı tek ofis metnini açmaz (katalog k≥2 kapısı).",
  }),
];

const security: AnySettingDef[] = [
  defineBool({
    key: "platform.mfa_enforced",
    default: false,
    category: "guvenlik",
    label: "Platform personeli için zorunlu iki adımlı doğrulama",
    description: "Veritabanı kapılarının personelden AAL2 istemesi. Ortam değişkeni PLATFORM_MFA_ENFORCEMENT ile birlikte tutarlı olmalıdır.",
    impact: "Yayın öncesi açılacak; şu an kapalı tutulur. Tutarsız durumda (env açık, bu ayar kapalı) /admin üstünde uyarı görünür.",
    risk: "high",
    editMode: "locked",
    lockedReason: "Zorunlu MFA yayın planına göre ayrıca açılır; bu merkezden değiştirilemez. Durum yalnız gösterilir.",
    envFallback: "PLATFORM_MFA_ENFORCEMENT",
  }),
];

const BRIDGES: { key: string; storageKey: string; category: AnySettingDef["category"]; label: string; description: string; impact: string; href: string }[] = [
  { key: "billing.plan_definitions", storageKey: "billing.plan_definitions", category: "faturalama", label: "Plan tanımları ve fiyatlar", description: "Plan fiyatları, koltuk ve özellik sınırları (yönetici geçersiz kılmaları).", impact: "Yeni satışları ve yenilemeleri etkiler; mevcut kilitli fiyatlar korunur.", href: "/admin/billing/planlar" },
  { key: "billing.seat_settings", storageKey: "billing.seat_settings", category: "faturalama", label: "Koltuk ayarları", description: "Ek koltuk fiyatlandırma ve dönem ayarları.", impact: "Ek koltuk siparişlerinin tutarını etkiler.", href: "/admin/billing/planlar" },
  { key: "ef.tariff", storageKey: "ef.tariff", category: "emlakfiyati", label: "EmlakFiyatı analiz tarifesi", description: "İşlem başına analiz bakiyesi maliyeti.", impact: "Yeni değerleme ve rapor işlemlerinin analiz bakiyesi bedelini değiştirir.", href: "/admin/analiz-tarifesi" },
  { key: "ef.packs", storageKey: "ef.packs", category: "emlakfiyati", label: "Analiz paketleri", description: "Satışa açık analiz paketleri.", impact: "Ofislerin satın alabileceği paketleri değiştirir.", href: "/admin/analiz-tarifesi" },
  { key: "ef.welcome_units", storageKey: "ef.welcome_units", category: "emlakfiyati", label: "Hoş geldin analiz bakiyesi", description: "Yeni ofise verilen analiz bakiyesi miktarı.", impact: "Yalnız bundan sonra açılan ofisleri etkiler.", href: "/admin/billing/planlar" },
  { key: "ef.welcome_since", storageKey: "ef.welcome_since", category: "emlakfiyati", label: "Hoş geldin analiz bakiyesi başlangıç tarihi", description: "Hoş geldin analiz bakiyesinin geçerli olduğu başlangıç.", impact: "Tarihten önce açılan ofisler analiz bakiyesi almaz.", href: "/admin/billing/planlar" },
  { key: "ef.wholesale", storageKey: "ef.wholesale", category: "emlakfiyati", label: "Toptan analiz bakiyesi maliyeti", description: "Analiz bakiyesi ekonomisi (maliyet) hesabında kullanılan toptan birim.", impact: "Muhasebe ekranındaki analiz bakiyesi kârlılığı hesabını etkiler.", href: "/admin/muhasebe" },
  { key: "ai.credit_cost_table", storageKey: "ai.credit_cost_table", category: "ai", label: "AI kredi maliyet tablosu", description: "AI özelliklerinin kredi bedelleri.", impact: "Ofislerin AI kullanımında düşen kredi miktarını değiştirir.", href: "/admin/ai-kullanim" },
];

const bridges: AnySettingDef[] = BRIDGES.map((b) =>
  defineJson({
    key: b.key,
    storageKey: b.storageKey,
    default: "",
    category: b.category,
    label: b.label,
    description: b.description,
    impact: b.impact,
    editHref: b.href,
    permission: SUPER,
  }),
);

const GROWTH_FLAGS = [
  { storageKey: "growth_referral_enabled", key: "growth.referral_enabled", label: "Referans (davet) programı", description: "Ofis davet ve ödül programı bayrağı." },
  { storageKey: "growth_partner_enabled", key: "growth.partner_enabled", label: "Ortak programı", description: "Ortak (partner) komisyon programı bayrağı." },
  { storageKey: "growth_cash_payout_enabled", key: "growth.cash_payout_enabled", label: "Nakit ortak ödemesi", description: "Ortak ödemelerinin nakit yapılması (ortak programından ayrı)." },
] as const;

const growth: AnySettingDef[] = GROWTH_FLAGS.map((g) =>
  defineBool({
    key: g.key,
    storageKey: g.storageKey,
    default: false,
    category: "buyume",
    label: g.label,
    description: g.description,
    impact: "Kapalıyken ilgili program ekranları ve ödül hesapları çalışmaz.",
    risk: "high",
    editMode: "bridge",
    editHref: "/admin/growth",
  }),
);

const integrations: AnySettingDef[] = [
  defineSecret({
    key: "ai.openai_api_key",
    storageKey: "openai_api_key",
    legacyKeys: ["openai_api_key"],
    maxLength: 256,
    minLength: 20,
    pattern: /^sk-/,
    patternMessage: "Geçersiz anahtar biçimi (sk- ile başlamalı).",
    category: "ai",
    label: "OpenAI API anahtarı",
    description: "Platformun AI çağrıları için kullandığı anahtar. Veritabanında şifreli saklanır; ortam değişkeni OPENAI_API_KEY yedektir.",
    impact: "Değişiklik tüm AI özelliklerini (asistan, ilan metni, değerleme açıklaması) bir sonraki çağrıda etkiler. Silinirse ortam anahtarına düşülür.",
    envFallback: "OPENAI_API_KEY",
  }),
  defineString({
    key: "notify.netgsm_usercode",
    storageKey: "netgsm_usercode",
    default: "",
    maxLength: 64,
    category: "bildirim",
    label: "Netgsm kullanıcı kodu",
    description: "Platform yedek SMS hesabı kullanıcı kodu.",
    impact: "Platform SMS gönderimi bu hesapla yapılır.",
    editMode: "bridge",
    editHref: "/admin/sistem",
    envFallback: "NETGSM_USERCODE",
  }),
  defineSecret({
    key: "notify.netgsm_password",
    storageKey: "netgsm_password",
    maxLength: 256,
    category: "bildirim",
    label: "Netgsm parolası",
    description: "Platform yedek SMS hesabı parolası. Şifreli saklanır.",
    impact: "Yanlış parola SMS gönderimini durdurur. Kullanıcı kodu ve başlık /admin/sistem ekranındadır.",
    envFallback: "NETGSM_PASSWORD",
  }),
  defineString({
    key: "notify.netgsm_msgheader",
    storageKey: "netgsm_msgheader",
    default: "",
    maxLength: 11,
    category: "bildirim",
    label: "Netgsm mesaj başlığı",
    description: "Onaylı SMS başlığı (1-11 karakter).",
    impact: "Gönderilen SMS'lerde gönderici adı olarak görünür.",
    editMode: "bridge",
    editHref: "/admin/sistem",
    envFallback: "NETGSM_MSGHEADER",
  }),
  defineString({
    key: "notify.whatsapp_api_url",
    storageKey: "whatsapp_api_url",
    default: "",
    maxLength: 512,
    category: "bildirim",
    label: "WhatsApp API adresi",
    description: "İzinli sağlayıcı alan adına sahip HTTPS adresi (SSRF koruması).",
    impact: "WhatsApp gönderimi bu adrese yapılır.",
    editMode: "bridge",
    editHref: "/admin/sistem",
    envFallback: "WHATSAPP_API_URL",
  }),
  defineSecret({
    key: "notify.whatsapp_api_token",
    storageKey: "whatsapp_api_token",
    maxLength: 4096,
    category: "bildirim",
    label: "WhatsApp API anahtarı",
    description: "WhatsApp sağlayıcı erişim anahtarı. Şifreli saklanır.",
    impact: "Yanlış anahtar WhatsApp gönderimini durdurur. API adresi /admin/sistem ekranındadır.",
    envFallback: "WHATSAPP_API_TOKEN",
  }),
];

const portals: AnySettingDef[] = PORTAL_NAMES.flatMap((p) => [
  defineSecret({
    key: `portal.${p}.api_key`,
    storageKey: `${p}_api_key`,
    maxLength: 4096,
    category: "entegrasyon",
    label: `${p[0].toUpperCase()}${p.slice(1)} API anahtarı`,
    description: "Portal ilan yayını için kurumsal sözleşme anahtarı. Şifreli saklanır. Adres ve ofis kimliği /admin/sistem ekranındadır.",
    impact: "Yanlış anahtar bu portala ilan yayınını durdurur.",
    envFallback: `${p.toUpperCase()}_API_KEY`,
  }),
  defineSecret({
    key: `portal.${p}.api_secret`,
    storageKey: `${p}_api_secret`,
    maxLength: 4096,
    category: "entegrasyon",
    label: `${p[0].toUpperCase()}${p.slice(1)} API gizli anahtarı`,
    description: "Portal gizli anahtarı (varsa). Şifreli saklanır.",
    impact: "Yanlış değer bu portala ilan yayınını durdurur.",
    envFallback: `${p.toUpperCase()}_API_SECRET`,
  }),
  defineString({
    key: `portal.${p}.agency_id`,
    storageKey: `${p}_agency_id`,
    default: "",
    maxLength: 512,
    category: "entegrasyon",
    label: `${p[0].toUpperCase()}${p.slice(1)} ofis kimliği`,
    description: "Portalın ofise verdiği kurumsal kimlik.",
    impact: "Portal ilan yayınlarında ofis tanımlayıcısı olarak gönderilir.",
    editMode: "bridge",
    editHref: "/admin/sistem",
    envFallback: `${p.toUpperCase()}_AGENCY_ID`,
  }),
  defineString({
    key: `portal.${p}.base_url`,
    storageKey: `${p}_base_url`,
    default: "",
    maxLength: 512,
    category: "entegrasyon",
    label: `${p[0].toUpperCase()}${p.slice(1)} API adresi`,
    description: "Sözleşmede verilen HTTPS API tabanı (izinli alan adı denetimi yazımda yapılır).",
    impact: "Yanlış adres bu portala yayını durdurur.",
    risk: "high",
    editMode: "bridge",
    editHref: "/admin/sistem",
    envFallback: `${p.toUpperCase()}_BASE_URL`,
  }),
]);

/**
 * Yasal metinler (başvuru formu onay/aydınlatma/pazarlama). Varsayılan = legal-copy.ts sabitleri (davranış değişmez);
 * değişiklik rıza kanıtı sürümüne metin izi olarak yansır (buildLeadConsentVersion). Metin sorumluluğu ofis/şirket sahibindedir.
 */
export const LEGAL_HOME = { href: "/admin/ayarlar/yasal", label: "Ayarlar > Yasal metinler" } as const;
const legal: AnySettingDef[] = [
  defineString({
    key: "legal.lead_consent_text",
    home: LEGAL_HOME,
    default: DEFAULT_LEAD_FORM_COPY.consent,
    maxLength: 300,
    minLength: 10,
    multiline: true,
    category: "uyum",
    label: "Başvuru formu zorunlu onay metni",
    description: "Ofis başvuru formundaki zorunlu kişisel veri onay kutusunun metni.",
    impact: "Yeni başvurularda gösterilir; rıza kanıtındaki sürüm metnin iziyle değişir. Eski kanıtlar etkilenmez.",
    risk: "high",
  }),
  defineString({
    key: "legal.lead_notice_text",
    home: LEGAL_HOME,
    default: DEFAULT_LEAD_FORM_COPY.notice,
    maxLength: 300,
    minLength: 10,
    multiline: true,
    category: "uyum",
    label: "Başvuru formu aydınlatma satırı",
    description: "Onay kutusunun üstündeki, aydınlatma metnine yönlendiren bilgi satırı.",
    impact: "Yeni başvurularda gösterilir; rıza kanıtındaki sürüm metnin iziyle değişir.",
    risk: "high",
  }),
  defineString({
    key: "legal.lead_marketing_text",
    home: LEGAL_HOME,
    default: DEFAULT_LEAD_FORM_COPY.marketing,
    maxLength: 300,
    minLength: 10,
    multiline: true,
    category: "uyum",
    label: "Başvuru formu isteğe bağlı pazarlama izni metni",
    description: "Ayrı, varsayılan işaretsiz pazarlama izni kutusunun metni.",
    impact: "Yeni başvurularda gösterilir; izin kanıtı ayrı sürüm ekiyle saklanır.",
    risk: "high",
  }),
];

/**
 * İşlemsel e-posta şablonları (konu + gövde). Varsayılan = `src/lib/email/templates.ts`. Gönderim yalnız e-posta kanalı
 * (RESEND_API_KEY + EMAIL_FROM) açıkken yapılır; kanal kapalıyken metinler düzenlenebilir ama kullanılmaz.
 */
export const EMAIL_HOME = { href: "/admin/ayarlar/eposta", label: "Ayarlar > E-posta şablonları" } as const;
const emailTemplates: AnySettingDef[] = EMAIL_TEMPLATES.flatMap((t) => [
  defineString({
    key: templateSettingKey(t.key, "subject"),
    home: EMAIL_HOME,
    default: t.defaultSubject,
    maxLength: 200,
    minLength: 3,
    category: "bildirim",
    label: `${t.label}: e-posta konusu`,
    description: `Değişkenler: ${t.variables.map((v) => `{${v}}`).join(", ")}.`,
    impact: `Bu şablonla giden e-postaların konu satırı değişir. Gönderen akış: ${t.usedBy}`,
  }),
  defineString({
    key: templateSettingKey(t.key, "body"),
    home: EMAIL_HOME,
    default: t.defaultBody,
    maxLength: 4000,
    minLength: 10,
    multiline: true,
    category: "bildirim",
    label: `${t.label}: e-posta gövdesi`,
    description: `Düz metin. Değişkenler: ${t.variables.map((v) => `{${v}}`).join(", ")}.`,
    impact: `Bu şablonla giden e-postaların metni değişir. Gönderen akış: ${t.usedBy}`,
  }),
]);

/** E-posta gönderen biçimi: "Ad <adres@alan.tld>" ya da çıplak "adres@alan.tld" (provider.ts aynı kuralı kullanır). */
export const EMAIL_FROM_RE = /^(?:[^<>\r\n]{1,100}\s<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;
const PLAIN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * E-posta kanalı (Resend). Çözüm sırası provider.ts'te: ortam değişkeni (öncelikli) > bu ayarlar > kapalı.
 * Anahtar şifreli saklanır (PLATFORM_SECRETS_KEY); değişiklik geçmişe ve denetim izine yalnız parmak iziyle yazılır.
 * iyzico anahtarları panele TAŞINMAZ (bilinçli karar; ortamda kalır).
 */
const emailFromDef = defineString({
  key: "email.from",
  home: EMAIL_HOME,
  default: "",
  maxLength: 200,
  category: "bildirim",
  label: "E-posta gönderen adresi",
  description: "Biçim: Ad <adres@alanadi.com>. Alan adı Resend'de doğrulanmış olmalı. Ortam değişkeni EMAIL_FROM tanımlıysa o önceliklidir.",
  impact: "Tüm işlemsel e-postaların gönderen satırı değişir; doğrulanmamış alan adıyla gönderim reddedilir.",
  envFallback: "EMAIL_FROM",
});
const emailReplyToDef = defineString({
  key: "email.reply_to",
  home: EMAIL_HOME,
  default: "",
  maxLength: 254,
  category: "bildirim",
  label: "E-posta yanıt adresi",
  description: "İsteğe bağlı. Alıcı \"Yanıtla\" dediğinde gidecek adres (adres@alanadi.com). Ortam değişkeni EMAIL_REPLY_TO önceliklidir.",
  impact: "Boşsa yanıtlar gönderen adresine gider.",
  envFallback: "EMAIL_REPLY_TO",
});
const emailChannel: AnySettingDef[] = [
  defineSecret({
    key: "email.resend_api_key",
    home: EMAIL_HOME,
    maxLength: 256,
    minLength: 20,
    pattern: /^re_[A-Za-z0-9_]+$/,
    patternMessage: "Geçersiz anahtar biçimi (re_ ile başlamalı).",
    category: "bildirim",
    label: "Resend API anahtarı",
    description: "İşlemsel e-posta sağlayıcısı anahtarı. Şifreli saklanır ve bir daha gösterilmez. Ortam değişkeni RESEND_API_KEY tanımlıysa o önceliklidir.",
    impact: "Anahtar yoksa ya da çözülemezse e-posta kanalı kapalıdır (uygulama içi bildirimler sürer).",
    envFallback: "RESEND_API_KEY",
  }),
  {
    ...emailFromDef,
    schema: z
      .string()
      .trim()
      .max(200)
      .refine((v) => v === "" || EMAIL_FROM_RE.test(v), "Biçim: Ad <adres@alanadi.com> ya da adres@alanadi.com."),
  } as AnySettingDef,
  {
    ...emailReplyToDef,
    schema: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === "" || PLAIN_EMAIL_RE.test(v), "Geçerli bir e-posta adresi girin."),
  } as AnySettingDef,
];

/** Hata gürültüsü: bu kadar gündür görülmeyen açık hata türü operational-retention cron'unda kendiliğinden kapanır. */
export const ERRORS_AUTO_RESOLVE_DAYS_KEY = "errors.auto_resolve_days";
const ops: AnySettingDef[] = [
  defineInt({
    key: ERRORS_AUTO_RESOLVE_DAYS_KEY,
    default: 14,
    min: 1,
    max: 365,
    category: "saglik",
    label: "Hata kaydı otomatik kapanma (gün)",
    description: "Bu kadar gündür yeniden görülmeyen açık hata türleri gece temizliğinde \"çözüldü\" sayılır.",
    impact: "Hata yeniden görülürse yeni açık kayıt olarak döner; kapanan sayı cron nabız notuna yazılır.",
    unit: "gün",
  }),
];

export const PLATFORM_SETTING_DEFS: readonly AnySettingDef[] = [
  ...general,
  ...security,
  ...portalRules,
  ...legal,
  ...growth,
  ...bridges,
  ...integrations,
  ...portals,
  ...emailTemplates,
  ...emailChannel,
  ...ops,
];