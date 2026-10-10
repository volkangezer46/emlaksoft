import { DEFAULT_SLA_MIN, SLA_OPTIONS_MIN } from "@/lib/response-time/core";
import type { AnySettingDef } from "../types";
import { defineBool, defineEnum, defineInt, defineNumber } from "./define";

/**
 * OFIS (tenant) ayarlari — Ofis Tanimlari Merkezi (/app/ayarlar/merkez).
 * KURAL: her varsayilan bugunku koddaki sabitle AYNIDIR (tenant.test.ts kilitler); ofis degistirmedikce davranis degismez.
 * Depo: tenant_settings (RLS: kendi ofisi okur) — yazma yalniz write_setting RPC'si (lib/settings/write.ts).
 * Yetki: ayarlar modulu (requirePermission("settings","edit")). Yalniz KODDA BAGLI olanlar tanimlanir (bos vaat yok).
 */

const TENANT = {
  scope: "tenant",
  storage: "tenant_settings",
  permission: { appModule: "settings" },
  category: "bayrak",
} as const;

/** Ondalik ayristirici (virgul/nokta); bozuk veya aralik disi = varsayilan. */
function numberParser(def: number, min: number, max: number) {
  return (raw: string | null | undefined): number => {
    const n = Number(String(raw ?? "").trim().replace(",", "."));
    return raw != null && Number.isFinite(n) && n >= min && n <= max ? n : def;
  };
}

const sla: AnySettingDef[] = [
  defineEnum({
    ...TENANT,
    key: "office.sla.lead_first_response_min",
    group: "sla",
    default: String(DEFAULT_SLA_MIN),
    options: SLA_OPTIONS_MIN.map((m) => ({ value: String(m), label: m >= 60 ? `${m / 60} saat` : `${m} dakika` })),
    label: "İlk yanıt süresi",
    description: "Yeni gelen talep/başvuruya ilk dönüşün yapılması gerektiği süre. Yanıt hızı raporu bu süreye göre \"zamanında\" sayar.",
    impact: "Yanıt hızı raporunun varsayılan eşiği değişir; raporda eşik seçicisi yine kullanılabilir. Geçmiş veri silinmez, yalnız zamanında/geç sınıflaması yeniden hesaplanır.",
    unit: "dakika",
  }),
];

const thresholds: AnySettingDef[] = [
  defineInt({
    ...TENANT,
    key: "office.alert.deal_stale_days",
    group: "esik",
    default: 14,
    min: 3,
    max: 180,
    label: "Hareketsiz anlaşma eşiği",
    description: "Açık bir anlaşma kaç gündür güncellenmediğinde \"hareketsiz\" sayılsın.",
    impact: "Anlaşmalar sayfasındaki hareketsiz sayacı, bayat filtresi ve bayat kart işareti bu günle çalışır. Düşürürseniz daha çok anlaşma uyarı alır.",
    unit: "gün",
  }),
  defineInt({
    ...TENANT,
    key: "office.alert.demand_aging_days",
    group: "esik",
    default: 30,
    min: 7,
    max: 365,
    label: "Bekleyen talep eşiği",
    description: "Açık bir talep kaç gündür kapanmadığında \"yaşlanan talep\" sayılsın.",
    impact: "Talepler sayfasındaki \"gündür açık\" kartı ve filtresi bu günle çalışır. Düşürürseniz daha çok talep yaşlanmış görünür.",
    unit: "gün",
  }),
];

const commission: AnySettingDef[] = [
  defineNumber({
    ...TENANT,
    key: "office.commission.simulator_rate",
    group: "komisyon",
    default: 3,
    min: 0.1,
    max: 20,
    parse: numberParser(3, 0.1, 20),
    label: "Komisyon hesaplayıcı başlangıç oranı",
    description: "Komisyon sayfasındaki simülatör açıldığında oran kutusunun başlangıç değeri (portföy oranını değiştirmez).",
    impact: "Yalnız simülatörün açılış değeri değişir; kayıtlı komisyonlar ve portföy oranları etkilenmez.",
    unit: "%",
  }),
  defineNumber({
    ...TENANT,
    key: "office.commission.simulator_advisor_share",
    group: "komisyon",
    default: 60,
    min: 0,
    max: 100,
    parse: numberParser(60, 0, 100),
    label: "Komisyon hesaplayıcı danışman payı",
    description: "Simülatör açıldığında danışman payı kutusunun başlangıç değeri.",
    impact: "Yalnız simülatörün açılış değeri değişir; gerçek bölüşümler etkilenmez.",
    unit: "%",
  }),
  defineNumber({
    ...TENANT,
    key: "office.commission.split_advisor_share",
    group: "komisyon",
    default: 50,
    min: 0,
    max: 100,
    parse: numberParser(50, 0, 100),
    label: "Kapanış bölüşümünde danışman payı",
    description: "Kazanılan anlaşmada komisyon payları ilk kez düzenlenirken önerilen danışman payı (kalan pay ofise yazılır).",
    impact: "Yalnız henüz pay kaydedilmemiş anlaşmalarda önerilen değer değişir; kayıtlı paylar etkilenmez.",
    unit: "%",
  }),
  defineNumber({
    ...TENANT,
    key: "office.commission.default_rate",
    group: "komisyon",
    default: 3,
    min: 0.1,
    max: 20,
    parse: numberParser(3, 0.1, 20),
    label: "Portföyde oran yoksa varsayılan komisyon oranı",
    description: "Portföyün komisyon oranı boşken kaçan komisyon tahmininde (İlan Kontrol uyarıları) ve komisyon hesabında yedek olarak kullanılan oran.",
    impact: "Yalnız portföyünde oran girilmemiş kayıtların TAHMİNİ tutarı değişir; portföy oranları ve kayıtlı komisyonlar etkilenmez.",
    unit: "%",
  }),
];

const insight: AnySettingDef[] = [
  defineInt({
    ...TENANT,
    key: "office.insight.customer_quiet_days",
    group: "esik",
    default: 14,
    min: 7,
    max: 90,
    label: "Sessiz değerli müşteri eşiği (arama önceliği)",
    description: "Açık talebi olan bir müşteriyle kaç gündür temas yoksa içgörülerde \"arama önceliği\" önerilsin.",
    impact: "Yalnız içgörü kuyruğundaki arama önceliği önerileri değişir; müşteri kayıtlarına dokunulmaz. Düşürürseniz daha çok öneri üretilir.",
    unit: "gün",
  }),
  defineInt({
    ...TENANT,
    key: "office.insight.listing_stale_days",
    group: "esik",
    default: 30,
    min: 14,
    max: 180,
    label: "Eskiyen ilan eşiği (fiyat aksiyonu)",
    description: "Bir ilan kaç gündür satılmadığında içgörülerde emsallere göre fiyat aksiyonu önerilsin.",
    impact: "Yalnız içgörü kuyruğundaki fiyat aksiyonu önerileri değişir; fiyatlar kendiliğinden değişmez.",
    unit: "gün",
  }),
  defineInt({
    ...TENANT,
    key: "office.insight.dormant_days",
    group: "esik",
    default: 90,
    min: 30,
    max: 365,
    label: "Uykuda müşteri eşiği",
    description: "Temas olmayan bir müşteri kaç günden sonra \"uykuda\" segmentine alınsın.",
    impact: "Müşteri listesindeki ısı segmenti (uykuda/soğuk) ve uykuda filtresi değişir; ısı puanı hesabı aynı kalır.",
    unit: "gün",
  }),
];

/** Bildirim tercihi anahtarlari (NotifPrefs) ve ofis varsayilani: notification-prefs.ts DEFAULTS ile ayni. */
export const NOTIFY_DEFAULTS: { id: string; label: string; description: string; default: boolean }[] = [
  { id: "portal", label: "Portal etkileşimleri", description: "Müşteri portalındaki beğeni ve yorumlar", default: true },
  { id: "appointment", label: "Randevular", description: "Randevu hatırlatma ve değişiklikleri", default: true },
  { id: "commission", label: "Komisyon", description: "Komisyon ve ödeme gelişmeleri", default: true },
  { id: "digest", label: "Günlük özet", description: "Günlük özet bildirimi", default: true },
  { id: "marketing", label: "Duyuru ve kampanyalar", description: "Platform duyuru ve kampanya bildirimleri", default: false },
  { id: "priceDrop", label: "Fiyat düşüşü", description: "Portföy fiyat düşüşü bildirimleri", default: true },
  { id: "savedSearch", label: "Kayıtlı aramalar", description: "Kayıtlı aramaya uyan yeni portföyler", default: true },
  { id: "share", label: "Paylaşımlar", description: "Paylaşılan portföy ve taleplerle ilgili bildirimler", default: true },
  { id: "dunning", label: "Ödeme uyarıları", description: "Abonelik ödemesi uyarıları", default: true },
  { id: "rentOverdue", label: "Geciken kira", description: "Geciken kira tahsilatı uyarıları", default: true },
  { id: "network", label: "Ofis ağı", description: "Ofis ağı paylaşım bildirimleri", default: true },
  { id: "insight", label: "İçgörüler", description: "Akıllı içgörü bildirimleri", default: true },
  { id: "support", label: "Destek talepleri", description: "Destek talebi yanıt ve durum", default: true },
  { id: "assignment", label: "Devir ve atamalar", description: "Size devredilen müşteri, portföy, iş yükü ve başkasının sizin adınıza açtığı randevu", default: true },
  { id: "authority", label: "Portföy yetki bitimi", description: "Portföy yetki (satış/kiralama yetkisi) bitiş hatırlatmaları", default: true },
  { id: "survey", label: "Anket sonuçları", description: "Düşük puan takibi, destekleyen müşteri ve ekip nabzı daveti", default: true },
];

export const notifyKey = (id: string) => `office.notify.default_${id.toLowerCase()}`;

const notify: AnySettingDef[] = NOTIFY_DEFAULTS.map((n) =>
  defineBool({
    ...TENANT,
    category: "bildirim",
    key: notifyKey(n.id),
    group: "bildirim",
    default: n.default,
    label: `Varsayılan: ${n.label}`,
    description: `${n.description} bildirimi, kendi tercihini hiç kaydetmemiş kullanıcılar için ${n.default ? "açık" : "kapalı"} başlar.`,
    impact: "Yalnız bildirim tercihini hiç kaydetmemiş (veya o tercihi hiç belirlememiş) kullanıcıları etkiler; kaydedilmiş kişisel tercihler korunur.",
  }),
);

/** İlan Kontrol rapor teslimi: AÇIK/KAPALI (varsayılan kapalı = bugünkü davranış, hiçbir bildirim eklenmez). */
export const LC_REPORT_DAILY_KEY = "office.listing_control.report_daily";
export const LC_REPORT_WEEKLY_KEY = "office.listing_control.report_weekly";

const lcReport: AnySettingDef[] = [
  defineBool({
    ...TENANT,
    category: "bildirim",
    key: LC_REPORT_DAILY_KEY,
    group: "bildirim",
    default: false,
    label: "Günlük İlan Kontrol raporu bildirimi",
    description: "Her sabah ofis sahibi ve genel müdüre açık/gecikmiş portal ilanı uyarılarının özeti zil bildirimi olarak gönderilir.",
    impact: "Açılırsa yöneticilere günde en çok 1 özet bildirimi gider (günlük özet tercihini kapatanlara gitmez). Kapalıyken hiçbir bildirim üretilmez.",
  }),
  defineBool({
    ...TENANT,
    category: "bildirim",
    key: LC_REPORT_WEEKLY_KEY,
    group: "bildirim",
    default: false,
    label: "Haftalık İlan Kontrol raporu bildirimi",
    description: "Her pazartesi ofis sahibi ve genel müdüre geçen haftanın portal ilanı uyarı özeti zil bildirimi olarak gönderilir.",
    impact: "Açılırsa yöneticilere haftada en çok 1 özet bildirimi gider. Kapalıyken hiçbir bildirim üretilmez.",
  }),
];

/**
 * Ofis Merkezi — akıllı atama. Ağırlıklar `src/lib/office-center/smart-assign.ts` DEFAULT_WEIGHTS ile aynı başlar
 * (smart-assign.test.ts kilitler); toplam 100 olmak zorunda değildir, motor oransal normalize eder.
 */
export const ASSIGN_WEIGHT_KEYS = {
  workload: "office.assign.weight_workload",
  specialty: "office.assign.weight_specialty",
  region: "office.assign.weight_region",
  performance: "office.assign.weight_performance",
  availability: "office.assign.weight_availability",
} as const;
export const ASSIGN_SLA_HOURS_KEY = "office.assign.unassigned_sla_hours";
export const UNASSIGNED_ALERT_KEY = "office.alert.unassigned_pool_count";

const ASSIGN_WEIGHT_DEFAULTS: Record<keyof typeof ASSIGN_WEIGHT_KEYS, { def: number; label: string; description: string }> = {
  workload: { def: 25, label: "Ağırlık: iş yükü", description: "Açık portföy + açık talep sayısı ofis ortalamasının altındaki danışman daha yüksek puan alır." },
  specialty: { def: 20, label: "Ağırlık: uzmanlık", description: "İlanın türü (konut/ticari/arsa) ve işlem türü (satılık/kiralık) danışmanın uzmanlık kaydıyla eşleşirse puan verir." },
  region: { def: 25, label: "Ağırlık: bölge", description: "İlanın il/ilçe/mahallesi danışmanın bölge kaydıyla eşleşirse puan verir (mahalle > ilçe > il)." },
  performance: { def: 15, label: "Ağırlık: son 90 gün performansı", description: "Son 90 gün kapanış oranı ve ilk yanıt uyumu; veri yetersizse nötr puan." },
  availability: { def: 15, label: "Ağırlık: müsaitlik", description: "Mesai içi/dışı ve son aktivite yakınlığı; izinli veya pasif danışman zaten elenir." },
};

const assign: AnySettingDef[] = [
  ...(Object.keys(ASSIGN_WEIGHT_KEYS) as (keyof typeof ASSIGN_WEIGHT_KEYS)[]).map((k) =>
    defineInt({
      ...TENANT,
      key: ASSIGN_WEIGHT_KEYS[k],
      group: "atama",
      default: ASSIGN_WEIGHT_DEFAULTS[k].def,
      min: 0,
      max: 100,
      label: ASSIGN_WEIGHT_DEFAULTS[k].label,
      description: ASSIGN_WEIGHT_DEFAULTS[k].description,
      impact: "Yalnız Ofis Merkezi > Atamalar'daki \"Akıllı öner\" sıralaması değişir; mevcut atamalar ve ilan havuzu puanı etkilenmez. 0 = bu ölçüt sayılmaz.",
      unit: "puan",
    }),
  ),
  defineInt({
    ...TENANT,
    key: ASSIGN_SLA_HOURS_KEY,
    group: "atama",
    default: 24,
    min: 1,
    max: 168,
    label: "Atanmamış ilan süre sınırı",
    description: "Danışmanı olmayan bir ilan kaç saatten uzun beklerse Ofis Merkezi'nde \"Gecikti\" sayılsın.",
    impact: "Ofis Merkezi > Atamalar'daki \"Gecikenler\" sayacı ve satır işareti değişir. Düşürürseniz daha çok ilan uyarı alır; bildirim üretmez.",
    unit: "saat",
  }),
  defineInt({
    ...TENANT,
    key: UNASSIGNED_ALERT_KEY,
    group: "esik",
    default: 5,
    min: 1,
    max: 500,
    label: "Atanmamış ilan uyarı eşiği",
    description: "Danışmanı olmayan ilan sayısı bu eşiğe ulaşınca Ofis Merkezi ekip sağlığı \"uyarı\" verir.",
    impact: "Yalnız Ofis Merkezi > İstatistikler'deki ekip sağlığı uyarısı değişir; atama yapılmaz, bildirim gönderilmez.",
    unit: "ilan",
  }),
];


/**
 * Kapsam uygulaması: AÇIK/KAPALI (varsayılan KAPALI = bugünkü davranış: listeler yalnız rol kuralıyla süzülür).
 * Açılınca talep/müşteri/portföy/anlaşma/görev listeleri ve CSV'leri kullanıcı kapsamına (kendi/takım/şube) daralır;
 * kapsam yalnız daraltır, mevcut rol kuralını asla genişletmez. Yönetimi: /app/ayarlar/yetkilendirme.
 */
export const SCOPE_ENFORCEMENT_KEY = "office.access.scope_enforcement";

const access: AnySettingDef[] = [
  defineBool({
    ...TENANT,
    key: SCOPE_ENFORCEMENT_KEY,
    group: "erisim",
    default: false,
    risk: "high",
    label: "Liste kapsamını uygula",
    description: "Açıkken talep, müşteri, portföy, anlaşma ve görev listeleri kullanıcının kapsamıyla (kendi kayıtları / takım / şube) sınırlanır; ofis geneli kapsamdaki yöneticiler etkilenmez.",
    impact: "Danışmanlar yalnız kendilerine atanmış kayıtları, takım liderleri takımlarını, şube müdürleri şubelerini görür. Kapatınca eski görünüm hemen geri gelir; veri silinmez veya değişmez.",
  }),
];

/**
 * Malik/müşteri iletişimi (hepsi varsayılan KAPALI = bugünkü davranış). Okuyucular: haftalık rapor `src/lib/owner-report/**`
 * (haftalik-ozet cron adımı + malik portalı), güncel değer özeti `src/lib/home-value/**` (müşteri portalı), vitrin sohbeti
 * `src/lib/ai/vitrin-chat.ts`.
 */
export const OWNER_WEEKLY_REPORT_KEY = "office.owner_report.weekly_enabled";
export const HOME_VALUE_SUMMARY_KEY = "office.customer_portal.home_value_enabled";
export const VITRIN_AI_CHAT_KEY = "office.vitrin.ai_chat_enabled";
/**
 * Anonim piyasa verisi paylaşım izni (ofis bazlı opt-in, varsayılan KAPALI). Okuyucu: platform dışa aktarımı
 * `/admin/ef-kontor/piyasa-verisi` (`src/lib/listing-control/market-export.ts`) yalnız açık ofislerin ilanlarını k≥5 hücrelerde toplar.
 */
export const MARKET_DATA_SHARE_KEY = "office.market_data.share_enabled";
/** Yetki belgesi yıllık harç kontrolü hatırlatma ayı ("0" = kapalı). Okuyucu: abonelik-kontrol cron'u (`license-reminders.ts`). */
export const LICENSE_FEE_MONTH_KEY = "office.license.annual_fee_month";

const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const contact: AnySettingDef[] = [
  defineBool({
    ...TENANT,
    key: OWNER_WEEKLY_REPORT_KEY,
    group: "iletisim",
    default: false,
    label: "Malike haftalık pazarlama raporu",
    description: "Her pazartesi aktif malik paneli bağlantısı olan portföyler için son 7 günün gösterim, teklif, ziyaretçi geri bildirimi ve vitrin görüntülenme özeti hazırlanır; malik panelinde \"Haftalık rapor\" bölümü görünür.",
    impact: "Ofisin kendi SMS hesabı bağlı ve malik telefonu kayıtlıysa malike rapor bağlantısı SMS ile gider; değilse sorumlu danışmana \"bağlantıyı malike gönderin\" bildirimi düşer. Kapalıyken hiçbir rapor/bildirim üretilmez.",
  }),
  defineBool({
    ...TENANT,
    key: HOME_VALUE_SUMMARY_KEY,
    group: "iletisim",
    default: false,
    label: "Müşteri portalında \"Evinizin güncel değeri\"",
    description: "Ofisten ev almış müşterinin portalında, ofisin emsal motoruna göre güncel değer ARALIĞI gösterilir (tahmin etiketli; emsal yetersizse hiç gösterilmez).",
    impact: "Açılırsa yalnız kazanılmış satış anlaşması olan müşterilerin portalında görünür. Kişisel veri veya başka müşterinin fiyatı gösterilmez; yalnız aralık ve emsal sayısı.",
  }),
  defineBool({
    ...TENANT,
    key: VITRIN_AI_CHAT_KEY,
    group: "iletisim",
    default: false,
    label: "Vitrinde yapay zekâ sohbet asistanı",
    description: "Vitrin ilan sayfasında ziyaretçi ilan hakkında soru sorabilir; asistan yalnız ilanın kayıtlı bilgileriyle yanıtlar, fiyat pazarlığı/kesin söz vermez ve her yanıtta danışmana bağlanma (talep formu) önerir.",
    impact: "AI kotanızdan harcar. Ziyaretçinin yazdığı telefon/e-posta/TC gibi kişisel veriler yapay zekâya gitmeden maskelenir. Kapalıyken asistan hiç görünmez.",
  }),
];

const compliance: AnySettingDef[] = [
  defineEnum({
    ...TENANT,
    key: "office.compliance.iys_mode",
    group: "uyum",
    default: "warn",
    options: [
      { value: "warn", label: "Yalnız uyar (gönderim yapılır)" },
      { value: "block", label: "İzinsiz alıcıyı atla" },
    ],
    label: "İYS izin kontrolü",
    description: "Ticari SMS/WhatsApp/e-posta gönderiminde alıcının kayıtlı izni yoksa ne yapılsın. Varsayılan: gönderim yapılır, izni eksik alıcı sayısı bilgi olarak gösterilir.",
    impact: "\"İzinsiz alıcıyı atla\" seçilirse kayıtlı izni olmayan alıcılara ticari ileti gönderilmez. İşlem amaçlı iletiler (randevu, imza, kira hatırlatma) her iki modda da gider.",
  }),
  defineEnum({
    ...TENANT,
    key: LICENSE_FEE_MONTH_KEY,
    group: "uyum",
    default: "0",
    options: [{ value: "0", label: "Kapalı" }, ...TR_MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))],
    label: "Yetki belgesi yıllık harç hatırlatma ayı",
    description: "Seçilen ayın ilk günü ofis sahibi ve genel müdüre yetki belgesi yıllık harç/ödeme ve belge geçerlilik kontrolü hatırlatması düşer (yılda bir kez).",
    impact: "Tutar veya son gün yazılmaz; belgenizden ve güncel mevzuattan doğrulayın. Kapalıyken hatırlatma üretilmez.",
  }),
  defineBool({
    ...TENANT,
    key: MARKET_DATA_SHARE_KEY,
    group: "uyum",
    default: false,
    label: "Anonim piyasa verisi paylaşımı (EmlakFiyati)",
    description: "Açılırsa ofisinizin yayındaki ilanlarından yalnız TOPLULAŞTIRILMIŞ ve anonim istatistikler (ilçe × portföy türü × ay: yayında kalma süresi, fiyat değişim bandı, kapanış süresi) bölgesel piyasa endeksine katkı olarak paylaşılabilir.",
    impact: "Kişisel veri, ilan kodu, adres, malik, danışman veya ofis adı paylaşılmaz; en az 5 ilanlık hücreler dışarı çıkar. Kapalıyken (varsayılan) ofisinizin verisi hiçbir dışa aktarıma girmez.",
  }),
];

/**
 * Talep dağıtımı (lead routing; Ofis Merkezi > Talep dağıtımı sekmesi). Hepsi varsayılan = BUGÜNKÜ davranış:
 * en az yüklü danışman, mesai kuralı yok, gecikmenda yeniden atama yok. Motor: `src/lib/lead-routing/*` (uzmanlık/bölge/yük
 * puanı ilan havuzu ve akıllı atama ile AYNI kod). Okuyucular: `lead-intake.ts` (yeni talep), havuz-atama cron adımı.
 */
export const LEAD_ROUTING_KEYS = {
  strategy: "office.lead_routing.strategy",
  hoursOnly: "office.lead_routing.hours_only",
  reassign: "office.lead_routing.reassign_on_breach",
  maxReassign: "office.lead_routing.max_reassign",
  slaMin: "office.sla.lead_first_response_min",
} as const;

const leadRouting: AnySettingDef[] = [
  defineEnum({
    ...TENANT,
    key: LEAD_ROUTING_KEYS.strategy,
    group: "dagitim",
    default: "least_loaded",
    options: [
      { value: "least_loaded", label: "En az yüklü danışman" },
      { value: "round_robin", label: "Sırayla (döngüsel)" },
      { value: "smart", label: "Akıllı (uzmanlık + yük)" },
    ],
    label: "Yeni talep dağıtım yöntemi",
    description: "Vitrin, portal ve başvuru formundan gelen yeni talebin hangi danışmana atanacağını belirler. Akıllı yöntem bölge/ilçe uzmanlığı, portföy türü ve iş yükünü birlikte puanlar.",
    impact: "Yalnız bundan sonra gelen talepler etkilenir; mevcut atamalar değişmez. Varsayılan (en az yüklü) bugünkü davranıştır.",
  }),
  defineBool({
    ...TENANT,
    key: LEAD_ROUTING_KEYS.hoursOnly,
    group: "dagitim",
    default: false,
    label: "Mesai dışı talebi mesai başında dağıt",
    description: "Açıkken Pazar günü ve 09:00-19:00 dışında gelen talep atanmadan bekler; mesai başlayınca dağıtılır (yanıt hızı raporundaki çalışma saati tanımıyla aynı).",
    impact: "Mesai dışı talepler sabaha kadar sorumlusuz görünür. Kapalıyken talep anında atanır.",
  }),
  defineBool({
    ...TENANT,
    key: LEAD_ROUTING_KEYS.reassign,
    group: "dagitim",
    default: false,
    label: "İlk dönüş süresi dolunca yeniden ata",
    description: "Talebe İlk yanıt süresi içinde dönülmezse (çalışma saatiyle) talep başka uygun danışmana devredilir; eski ve yeni sorumluya bildirim gider.",
    impact: "Açılırsa her 10 dakikada bir kontrol edilir; bir talep en çok aşağıdaki sayıda yeniden atanır, sonrasında yöneticiye uyarı düşer. Kapalıyken hiçbir talep otomatik devredilmez.",
  }),
  defineInt({
    ...TENANT,
    key: LEAD_ROUTING_KEYS.maxReassign,
    group: "dagitim",
    default: 2,
    min: 1,
    max: 5,
    label: "En çok yeniden atama sayısı",
    description: "Bir talep gecikme yüzünden en fazla kaç kez başka danışmana devredilsin.",
    impact: "Sınır dolunca talep yeniden atanmaz; ofis sahibi ve genel müdüre bir kez uyarı gider.",
    unit: "kez",
  }),
];

/**
 * Yapay zekâ özellikleri (ofis izni, hepsi varsayılan KAPALI). Her çağrı `openai-client.ts` üzerinden gider (kişisel veri
 * maskelenir, denetim kaydı + kredi defteri yazılır) ve çıktı yalnız TASLAKTIR; kullanıcı onaylamadan hiçbir kayıt değişmez.
 */
export const AI_LISTING_TEXT_KEY = "office.ai.listing_text_enabled";
export const AI_VOICE_NOTES_KEY = "office.ai.voice_notes_enabled";

const aiFeatures: AnySettingDef[] = [
  defineBool({
    ...TENANT,
    key: AI_LISTING_TEXT_KEY,
    group: "ai",
    default: false,
    label: "AI ile ilan açıklaması ve çeviri",
    description: "Portföy sayfasında \"AI ile ilan açıklaması oluştur\" ve İngilizce/Almanca/Arapça/Rusça çeviri düğmeleri çalışır. Çıktı taslaktır; siz onaylayıp kaydetmeden portföy değişmez.",
    impact: "AI kotanızdan harcar. Telefon, e-posta, TC, IBAN gibi kişisel veriler yapay zekâya gitmeden maskelenir. Kapalıyken yalnız şablon metni üretilir, çeviri kapalıdır.",
  }),
  defineBool({
    ...TENANT,
    key: AI_VOICE_NOTES_KEY,
    group: "ai",
    default: false,
    label: "Sesli not ve AI özeti",
    description: "Müşteri ve randevu kartında ses kaydı yapılır; kayıt yazıya çevrilip özetlenir ve not olarak saklanır. Ses dosyası SAKLANMAZ, yalnız metin tutulur. Kayıttan önce ilgili kişinin açık rızası onay kutusuyla alınır.",
    impact: "Ses kaydı yapay zekâ sağlayıcısına yazıya çevrilmek üzere gönderilir (KVKK aydınlatma/rıza sorumluluğu ofistedir). AI kotanızdan harcar. Kapalıyken düğme hiç görünmez.",
  }),
];

export const TENANT_SETTING_DEFS: AnySettingDef[] = [...sla, ...thresholds, ...commission, ...insight, ...notify, ...lcReport, ...assign, ...access, ...contact, ...compliance, ...leadRouting, ...aiFeatures];
