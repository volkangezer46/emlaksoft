/**
 * VERİ SAKLAMA ENVANTERİ (saf, yan etkisiz). Gece işi `operational-retention` (src/app/api/cron/operational-retention)
 * bağımsız ADIMLAR koşar; her adım bir saklama kuralıdır. Bu dosya adımların insan okur kataloğudur (ne silinir, ne
 * kadar süre saklanır, hukuki dayanak) ve son çalıştırmanın kalp atışı notundan (`cron_runs.detail`, en çok 500 karakter,
 * JSON `{ ...adımSonuçları, queue, errors }`) adım bazında durum çıkarır. Not kırpılmışsa bilinmeyen adım "bilinmiyor" kalır.
 */

export type RetentionStepKey =
  | "retention"
  | "storage"
  | "scopeOverrides"
  | "fsboPii"
  | "errorsAutoResolve"
  | "portalRulesLearn"
  | "portalLearningRetention"
  | "emailLog"
  | "messageLog"
  | "eidsInbound"
  | "kvkkUnverified"
  | "recruitRetention"
  | "demoReset"
  | "geoStats";

export type RetentionRule = {
  step: RetentionStepKey;
  label: string;
  /** Ne olur (silinir / maskelenir / kapanır). */
  action: string;
  /** Saklama süresi (insan okur). */
  period: string;
  /** Kişisel veri içeriyor mu (KVKK m.7 imha yükümlülüğü). */
  personal: boolean;
  /** Ayarla değiştirilebiliyorsa ayar ekranı. */
  settingHref?: string;
};

export const RETENTION_RULES: readonly RetentionRule[] = [
  { step: "retention", label: "Operasyonel kayıtlar", action: "Süresi dolan oturum, doğrulama kodu ve geçici kayıtlar silinir (veritabanı işlevi)", period: "Kayıt türüne göre (veritabanı kuralı)", personal: true },
  { step: "storage", label: "Depo dosyaları", action: "Silme kuyruğundaki dosyalar depodan kalıcı silinir (100'lük parti)", period: "Kuyruğa girer girmez", personal: true, settingHref: "/admin/kuyruklar#storage_deletion" },
  { step: "fsboPii", label: "Sahibinden ilan kişisel verisi", action: "Ad, telefon ve not silinir; ilan kaydı kalır", period: "Ofis ayarı 30–180 gün (varsayılan 90)", personal: true },
  { step: "kvkkUnverified", label: "Doğrulanmamış KVKK başvurusu", action: "E-postası doğrulanmayan başvuru silinir", period: "7 gün", personal: true, settingHref: "/admin/tickets/kvkk" },
  { step: "eidsInbound", label: "EİDS e-postaları", action: "Ham .eml (şifreli) silinir; ayrıştırılmış alanlar kalır; iletme kodu silinir", period: "30 gün (kod 24 saat)", personal: true },
  { step: "recruitRetention", label: "Danışman adayları", action: "Sonuçlanan ya da hareketsiz aday kaydı silinir", period: "Ofis ayarı 30–730 gün (varsayılan 180)", personal: true },
  { step: "emailLog", label: "E-posta günlüğü", action: "Olay ve gönderim satırları silinir; engel listesi kalır", period: "Olay 180 gün, gönderim 400 gün", personal: true, settingHref: "/admin/ayarlar/eposta" },
  { step: "messageLog", label: "SMS ve WhatsApp günlüğü", action: "Gönderim satırları silinir", period: "400 gün", personal: true },
  { step: "scopeOverrides", label: "Süresi dolan yetki istisnaları", action: "Bitişinden 90 gün geçen kapsam istisnası silinir", period: "Bitiş + 90 gün", personal: false },
  { step: "errorsAutoResolve", label: "Hata kayıtları", action: "Görülmeyen açık hata türü kendiliğinden kapanır", period: "Ayar (varsayılan 14 gün)", personal: false, settingHref: "/admin/sistem?sekme=hatalar" },
  { step: "portalLearningRetention", label: "Eklenti öğrenme gözlemleri", action: "Olay, rapor ve oylar silinir; katalog kalır", period: "Olay 180, rapor 90, oy 180 gün; katalog 1 yıl", personal: false },
  { step: "portalRulesLearn", label: "Eklenti kural öğrenmesi", action: "Oy ve önerilerden kural adayı üretilir (otomatik yayın ayarla)", period: "Her gece", personal: false },
  { step: "demoReset", label: "Demo ofis sıfırlaması", action: "Yalnız demo-ofis: sonradan eklenen iş kayıtları silinir", period: "Her gece", personal: false },
  { step: "geoStats", label: "Coğrafya sayım görünümleri", action: "Sayım görünümleri tazelenir", period: "Her gece", personal: false },
];

export type StepStatus = "ok" | "error" | "skipped" | "unknown";

export const STEP_STATUS_LABEL: Record<StepStatus, string> = { ok: "Tamam", error: "Hata", skipped: "Atlandı", unknown: "Bilinmiyor" };

export type ParsedRetentionRun = {
  steps: Partial<Record<RetentionStepKey, StepStatus>>;
  /** Not kırpıldı ya da JSON değil: adım durumları eksik olabilir. */
  partial: boolean;
  queue: { waiting: number; failed: number } | null;
};

const STEP_KEYS = new Set<string>(RETENTION_RULES.map((r) => r.step));

function statusOfResult(v: unknown): StepStatus {
  if (v === "skipped" || (v && typeof v === "object" && (v as { skipped?: unknown }).skipped === true)) return "skipped";
  return "ok";
}

/** `cron_runs.detail` (JSON ya da kırpılmış JSON) → adım durumları. Hata anahtarı her zaman sonucu ezer. */
export function parseRetentionDetail(detail: string | null | undefined): ParsedRetentionRun {
  const text = (detail ?? "").trim();
  if (!text) return { steps: {}, partial: true, queue: null };
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const steps: Partial<Record<RetentionStepKey, StepStatus>> = {};
    for (const [k, v] of Object.entries(obj)) if (STEP_KEYS.has(k)) steps[k as RetentionStepKey] = statusOfResult(v);
    const errors = obj.errors && typeof obj.errors === "object" ? Object.keys(obj.errors as object) : [];
    for (const k of errors) if (STEP_KEYS.has(k)) steps[k as RetentionStepKey] = "error";
    const q = obj.queue as { waiting?: unknown; failed?: unknown } | null | undefined;
    const queue = q && typeof q === "object" && typeof q.waiting === "number" && typeof q.failed === "number" ? { waiting: q.waiting, failed: q.failed } : null;
    return { steps, partial: false, queue };
  } catch {
    // Kırpılmış not: görünen üst düzey anahtarlar "ok" (değeri tam okunamaz), "errors" içinde görünenler hata.
    const steps: Partial<Record<RetentionStepKey, StepStatus>> = {};
    const errIdx = text.indexOf('"errors"');
    const head = errIdx === -1 ? text : text.slice(0, errIdx);
    for (const m of head.matchAll(/"([A-Za-z]+)":/g)) if (STEP_KEYS.has(m[1]!)) steps[m[1] as RetentionStepKey] = "ok";
    if (errIdx !== -1) for (const m of text.slice(errIdx).matchAll(/"([A-Za-z]+)":/g)) if (STEP_KEYS.has(m[1]!)) steps[m[1] as RetentionStepKey] = "error";
    return { steps, partial: true, queue: null };
  }
}

export type BackupRunRow = { finishedAt: string; status: "ok" | "error" | "partial"; sizeBytes: number | null; encrypted: boolean; remote: boolean };

export type BackupHealth = {
  last: BackupRunRow | null;
  /** Son başarılı yedekten bu yana saat; hiç yoksa null. */
  hoursSinceOk: number | null;
  okRate: number | null;
  /** "iyi" (≤26 sa, şifreli + uzak), "uyari" (≤50 sa ya da şifresiz/uzak kopya yok), "kritik" (daha eski ya da hiç). */
  level: "iyi" | "uyari" | "kritik";
};

/** Yedek koşularından sağlık seviyesi (en yeni önce verilmesi gerekmez). */
export function backupHealth(runs: readonly BackupRunRow[], nowMs: number): BackupHealth {
  const sorted = [...runs].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  const lastOk = sorted.find((r) => r.status === "ok");
  const hoursSinceOk = lastOk ? Math.max(0, Math.round(((nowMs - Date.parse(lastOk.finishedAt)) / 3_600_000) * 10) / 10) : null;
  const okRate = sorted.length ? Math.round((sorted.filter((r) => r.status === "ok").length / sorted.length) * 100) : null;
  let level: BackupHealth["level"] = "kritik";
  if (hoursSinceOk !== null && hoursSinceOk <= 50) level = "uyari";
  if (hoursSinceOk !== null && hoursSinceOk <= 26 && lastOk!.encrypted && lastOk!.remote) level = "iyi";
  return { last: sorted[0] ?? null, hoursSinceOk, okRate, level };
}

/** Bayt → "1,2 GB" (TR ondalık). */
export function formatBytesTr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("tr-TR", { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}
