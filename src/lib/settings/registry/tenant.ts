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
    label: "İlk yanıt SLA süresi",
    description: "Yeni gelen talep/başvuruya ilk dönüşün yapılması gerektiği süre. Aday hızı raporu bu süreye göre \"zamanında\" sayar.",
    impact: "Aday hızı raporunun varsayılan eşiği değişir; raporda eşik seçicisi yine kullanılabilir. Geçmiş veri silinmez, yalnız zamanında/geç sınıflaması yeniden hesaplanır.",
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
  performance: { def: 15, label: "Ağırlık: son 90 gün performansı", description: "Son 90 gün kapanış oranı ve ilk yanıt SLA uyumu; veri yetersizse nötr puan." },
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
    label: "Atanmamış ilan SLA süresi",
    description: "Danışmanı olmayan bir ilan kaç saatten uzun beklerse Ofis Merkezi'nde \"SLA aşıldı\" sayılsın.",
    impact: "Ofis Merkezi > Atamalar'daki \"SLA'sı geçen\" sayacı ve satır işareti değişir. Düşürürseniz daha çok ilan uyarı alır; bildirim üretmez.",
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

export const TENANT_SETTING_DEFS: AnySettingDef[] = [...sla, ...thresholds, ...commission, ...insight, ...notify, ...lcReport, ...assign];
