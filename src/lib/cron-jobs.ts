/**
 * Production cron inventory.
 *
 * `scripts/check-cron-contracts.ts` keeps this list, `vercel.json`, route
 * folders, authentication guards and heartbeat names in sync. The stale
 * window is deliberately schedule-aware: a monthly job must not be marked as
 * late merely because it did not run in the last 24 hours.
 */
export type CronJobDefinition = {
  job: string;
  label: string;
  path: `/api/cron/${string}`;
  schedule: string;
  cadenceLabel: string;
  staleAfterMinutes: number;
};

export const CRON_JOBS = [
  { job: "gunluk-ozet", label: "Günlük ofis özeti", path: "/api/cron/gunluk-ozet", schedule: "0 7 * * *", cadenceLabel: "her gün 07:00 UTC (10:00 TR)", staleAfterMinutes: 2_160 },
  { job: "randevu-hatirlat", label: "Randevu hatırlatma", path: "/api/cron/randevu-hatirlat", schedule: "*/30 * * * *", cadenceLabel: "30 dakikada bir", staleAfterMinutes: 90 },
  { job: "gorev-hatirlat", label: "Görev hatırlatma", path: "/api/cron/gorev-hatirlat", schedule: "0 */2 * * *", cadenceLabel: "2 saatte bir", staleAfterMinutes: 300 },
  { job: "portal-teyit", label: "Portal teyit takibi", path: "/api/cron/portal-teyit", schedule: "0 */6 * * *", cadenceLabel: "6 saatte bir", staleAfterMinutes: 840 },
  { job: "abonelik-kontrol", label: "Abonelik kontrolü", path: "/api/cron/abonelik-kontrol", schedule: "0 0 * * *", cadenceLabel: "her gün 00:00 UTC (03:00 TR)", staleAfterMinutes: 2_160 },
  { job: "leak-sla", label: "Kayıp-kaçak SLA", path: "/api/cron/leak-sla", schedule: "0 */12 * * *", cadenceLabel: "12 saatte bir", staleAfterMinutes: 1_560 },
  { job: "dogum-gunu", label: "Doğum günü / yıldönümü", path: "/api/cron/dogum-gunu", schedule: "0 8 * * *", cadenceLabel: "her gün 08:00 UTC (11:00 TR)", staleAfterMinutes: 2_160 },
  { job: "tcmb-kur", label: "TCMB kur çekimi", path: "/api/cron/tcmb-kur", schedule: "30 13 * * 1-5", cadenceLabel: "hafta içi 13:30 UTC (16:30 TR)", staleAfterMinutes: 4_800 },
  { job: "otomasyon", label: "Otomasyon motoru", path: "/api/cron/otomasyon", schedule: "0 6,14 * * *", cadenceLabel: "her gün 06:00 ve 14:00 UTC (09:00 ve 17:00 TR)", staleAfterMinutes: 900 },
  { job: "bolge-snapshot", label: "Bölge istatistik anlık görüntüsü", path: "/api/cron/bolge-snapshot", schedule: "0 3 1 * *", cadenceLabel: "ayın 1'i 03:00 UTC (06:00 TR)", staleAfterMinutes: 50_400 },
  { job: "vitrin-eslesme", label: "Vitrin arama eşleşmesi", path: "/api/cron/vitrin-eslesme", schedule: "0 10 * * *", cadenceLabel: "her gün 10:00 UTC (13:00 TR)", staleAfterMinutes: 2_160 },
  { job: "dunning", label: "Başarısız ödeme takibi", path: "/api/cron/dunning", schedule: "0 9 * * *", cadenceLabel: "her gün 09:00 UTC (12:00 TR)", staleAfterMinutes: 2_160 },
  { job: "kira-tahakkuk", label: "Kira tahakkuku", path: "/api/cron/kira-tahakkuk", schedule: "0 5 * * *", cadenceLabel: "her gün 05:00 UTC (08:00 TR)", staleAfterMinutes: 2_160 },
  { job: "proje-vade", label: "Proje vade takibi", path: "/api/cron/proje-vade", schedule: "30 5 * * *", cadenceLabel: "her gün 05:30 UTC (08:30 TR)", staleAfterMinutes: 2_160 },
  { job: "haftalik-ozet", label: "Haftalık ofis özeti", path: "/api/cron/haftalik-ozet", schedule: "30 7 * * 1", cadenceLabel: "pazartesi 07:30 UTC (10:30 TR)", staleAfterMinutes: 12_960 },
  { job: "geo-sync", label: "Coğrafya tutarlılık denetimi", path: "/api/cron/geo-sync", schedule: "0 4 1 */3 *", cadenceLabel: "3 ayda bir (ayın 1'i 04:00 UTC, 07:00 TR)", staleAfterMinutes: 144_000 },
  { job: "vitrin-alarm", label: "Vitrin fiyat alarmı", path: "/api/cron/vitrin-alarm", schedule: "30 10 * * *", cadenceLabel: "her gün 10:30 UTC (13:30 TR)", staleAfterMinutes: 2_160 },
  { job: "anket-gorevleri", label: "Anket görevleri üretimi", path: "/api/cron/anket-gorevleri", schedule: "20 6 * * *", cadenceLabel: "her gün 06:20 UTC (09:20 TR)", staleAfterMinutes: 2_160 },
  { job: "anahtar-gecikme", label: "Anahtar gecikme takibi", path: "/api/cron/anahtar-gecikme", schedule: "0 9 * * *", cadenceLabel: "her gün 09:00 UTC (12:00 TR)", staleAfterMinutes: 2_160 },
  { job: "lig-snapshot", label: "Performans ligi anlık görüntüsü", path: "/api/cron/lig-snapshot", schedule: "0 2 1 * *", cadenceLabel: "ayın 1'i 02:00 UTC (05:00 TR)", staleAfterMinutes: 50_400 },
  { job: "ticket-sla", label: "Destek talebi SLA", path: "/api/cron/ticket-sla", schedule: "*/5 * * * *", cadenceLabel: "5 dakikada bir", staleAfterMinutes: 20 },
  { job: "ticket-attachment-cleanup", label: "Destek eki temizliği", path: "/api/cron/ticket-attachment-cleanup", schedule: "15 */2 * * *", cadenceLabel: "2 saatte bir", staleAfterMinutes: 300 },
  { job: "operational-retention", label: "Operasyonel veri ve KVKK dosya temizliği", path: "/api/cron/operational-retention", schedule: "37 3 * * *", cadenceLabel: "her gün 03:37 UTC (06:37 TR)", staleAfterMinutes: 2_160 },
  { job: "campaign-delivery", label: "Kampanya teslimat kuyruğu", path: "/api/cron/campaign-delivery", schedule: "*/2 * * * *", cadenceLabel: "2 dakikada bir", staleAfterMinutes: 10 },
  { job: "billing-reconciliation", label: "Ödeme mutabakat kuyruğu", path: "/api/cron/billing-reconciliation", schedule: "3-59/10 * * * *", cadenceLabel: "10 dakikada bir", staleAfterMinutes: 30 },
  { job: "direct-file-upload-cleanup", label: "Doğrudan dosya yükleme temizliği", path: "/api/cron/direct-file-upload-cleanup", schedule: "25,55 * * * *", cadenceLabel: "30 dakikada bir", staleAfterMinutes: 90 },
  { job: "public-mutation-outbox", label: "Public işlem bildirim kuyruğu", path: "/api/cron/public-mutation-outbox", schedule: "*/2 * * * *", cadenceLabel: "2 dakikada bir", staleAfterMinutes: 10 },
  { job: "geo-province-sync", label: "İl bazlı coğrafya tarama kuyruğu", path: "/api/cron/geo-province-sync", schedule: "*/5 * * * *", cadenceLabel: "5 dakikada bir", staleAfterMinutes: 20 },
  { job: "seo-robot", label: "SEO robotu (site denetimi ve IndexNow)", path: "/api/cron/seo-robot", schedule: "20 4 * * *", cadenceLabel: "her gün 04:20 UTC (07:20 TR)", staleAfterMinutes: 2_160 },
  { job: "havuz-atama", label: "İlan havuzu atama süpürmesi", path: "/api/cron/havuz-atama", schedule: "6-59/10 * * * *", cadenceLabel: "10 dakikada bir", staleAfterMinutes: 40 },
  { job: "ef-kontor-hak", label: "EmlakFiyati aylık kontör hakkı", path: "/api/cron/ef-kontor-hak", schedule: "10 1 * * *", cadenceLabel: "her gün 01:10 UTC (04:10 TR)", staleAfterMinutes: 2_160 },
  { job: "growth-claims", label: "Referans/ortak ödül işleyicisi", path: "/api/cron/growth-claims", schedule: "40 3 * * *", cadenceLabel: "her gün 03:40 UTC (06:40 TR)", staleAfterMinutes: 2_160 },
  { job: "ef-kontor-sweep", label: "EmlakFiyati kontör rezerv süpürmesi", path: "/api/cron/ef-kontor-sweep", schedule: "8-59/10 * * * *", cadenceLabel: "10 dakikada bir", staleAfterMinutes: 40 },
] as const satisfies readonly CronJobDefinition[];
