/**
 * ARKA PLAN KUYRUKLARI (saf, yan etkisiz). Platformdaki dayanıklı iş kuyruklarının tek envanteri: hangi tablo, hangi
 * durum "bekliyor", hangisi "kalıcı hata", hangi zaman sütunu yaşı verir, hangi işçi (cron) boşaltır ve elle yeniden
 * kuyruğa alınabilir mi. Okuyucu `queue-health-read.ts` bu tanımla sayar; durum kararı burada (`queueState`).
 */

export type QueueKey = "public_mutation" | "storage_deletion" | "webhook" | "announcement" | "listing_verification" | "geo_sync";

export type QueueDef = {
  key: QueueKey;
  label: string;
  description: string;
  table: string;
  waiting: readonly string[];
  failed: readonly string[];
  /** Bekleyen işin yaşını veren sütun (en eski bekleyen). */
  ageColumn: string;
  /** Bekleyen iş bu kadar dakikadan eskiyse kuyruk "takıldı" sayılır (işçi temposunun birkaç katı). */
  stuckAfterMinutes: number;
  /** Boşaltan zamanlanmış iş (cron envanteri `src/lib/cron-jobs.ts`). */
  cronJob: string | null;
  /** Kalıcı hatalı satır elle yeniden kuyruğa alınabilir mi (yalnız idempotent işçiler). */
  retryable: boolean;
  /** Hata satırında gösterilecek sütun (kod/kısa metin; kişisel veri taşımayan). */
  errorColumn: string | null;
  attemptsColumn: string;
  /** Ayrıntı/çözüm ekranı. */
  href: string;
};

export const QUEUES: readonly QueueDef[] = [
  {
    key: "public_mutation",
    label: "Public işlem bildirimleri",
    description: "Randevu teyidi, açık randevu ve sahip teklif yanıtının ofis bildirimi ve denetim kaydı",
    table: "public_mutation_outbox",
    waiting: ["pending", "retry", "processing"],
    failed: ["dead_letter"],
    ageColumn: "next_attempt_at",
    stuckAfterMinutes: 30,
    cronJob: "public-mutation-outbox",
    retryable: true,
    errorColumn: "last_error_code",
    attemptsColumn: "attempt_count",
    href: "/admin/kuyruklar#public_mutation",
  },
  {
    key: "storage_deletion",
    label: "Dosya silme kuyruğu",
    description: "KVKK silmesi, kayıt silme ve süre dolumu sonrası depodan silinecek dosyalar",
    table: "storage_deletion_outbox",
    waiting: ["pending", "retry", "processing"],
    failed: ["failed"],
    ageColumn: "next_attempt_at",
    stuckAfterMinutes: 36 * 60,
    cronJob: "operational-retention",
    retryable: true,
    errorColumn: "last_error",
    attemptsColumn: "attempt_count",
    href: "/admin/kuyruklar#storage_deletion",
  },
  {
    key: "webhook",
    label: "Ofis webhook teslimleri",
    description: "Ofislerin kendi uçlarına giden olay bildirimleri (6 deneme, artan bekleme)",
    table: "webhook_deliveries",
    waiting: ["pending"],
    failed: ["failed"],
    ageColumn: "next_attempt_at",
    stuckAfterMinutes: 13 * 60,
    cronJob: "randevu-hatirlat",
    retryable: false,
    errorColumn: "last_status_code",
    attemptsColumn: "attempts",
    href: "/admin/sistem?sekme=entegrasyonlar",
  },
  {
    key: "announcement",
    label: "Duyuru gönderimleri",
    description: "Toplu duyurunun uygulama içi, e-posta ve anlık bildirim teslimleri",
    table: "platform_announcement_deliveries",
    waiting: ["pending", "sending"],
    failed: ["failed"],
    ageColumn: "created_at",
    stuckAfterMinutes: 2 * 60,
    cronJob: "campaign-delivery",
    retryable: false,
    errorColumn: "error",
    attemptsColumn: "attempts",
    href: "/admin/duyuru",
  },
  {
    key: "listing_verification",
    label: "İlan doğrulama işleri",
    description: "Portal ilanlarının yayında olup olmadığını doğrulayan tarayıcı eklentisi işleri",
    table: "listing_verification_jobs",
    waiting: ["queued", "claimed"],
    failed: ["failed", "expired"],
    ageColumn: "scheduled_at",
    stuckAfterMinutes: 48 * 60,
    cronJob: null,
    retryable: false,
    errorColumn: null,
    attemptsColumn: "retry_count",
    href: "/admin/portal-hesaplari",
  },
  {
    key: "geo_sync",
    label: "Coğrafya eşitleme",
    description: "İl bazında resmi kaynaktan ilçe ve mahalle içe aktarma işleri",
    table: "geo_sync_jobs",
    waiting: ["queued", "running", "retry"],
    failed: ["dead_letter"],
    ageColumn: "next_attempt_at",
    stuckAfterMinutes: 6 * 60,
    cronJob: "geo-province-sync",
    retryable: false,
    errorColumn: null,
    attemptsColumn: "attempt_count",
    href: "/admin/geo/ice-aktar",
  },
];

export const RETRYABLE_QUEUES = QUEUES.filter((q) => q.retryable).map((q) => q.key);

export function queueDef(key: string): QueueDef | null {
  return QUEUES.find((q) => q.key === key) ?? null;
}

export type QueueCounts = {
  waiting: number | null;
  failed: number | null;
  /** En eski bekleyen işin zaman damgası (ISO) ya da yok. */
  oldestWaitingAt: string | null;
};

export type QueueState = "saglikli" | "bos" | "birikiyor" | "takildi" | "hata" | "okunamadi";

export const QUEUE_STATE_LABEL: Record<QueueState, string> = {
  saglikli: "Akıyor",
  bos: "Boş",
  birikiyor: "Birikiyor",
  takildi: "Takıldı",
  hata: "Kalıcı hata var",
  okunamadi: "Okunamadı",
};

export const QUEUE_STATE_TONE: Record<QueueState, "success" | "neutral" | "warning" | "danger" | "info"> = {
  saglikli: "success",
  bos: "neutral",
  birikiyor: "warning",
  takildi: "danger",
  hata: "danger",
  okunamadi: "info",
};

/** Birikme eşiği: bekleyen bu sayının üstündeyse (yaş sınırı aşılmasa da) "birikiyor". */
export const QUEUE_BACKLOG_WARN = 200;

/**
 * Kuyruk durumu: tablo okunamadı → okunamadı; en eski bekleyen iş yaş sınırını aştı → takıldı (işçi çalışmıyor);
 * kalıcı hata var → hata; bekleyen eşik üstü → birikiyor; hiç iş yok → boş; aksi akıyor.
 */
export function queueState(def: Pick<QueueDef, "stuckAfterMinutes">, c: QueueCounts, nowMs: number): QueueState {
  if (c.waiting === null || c.failed === null) return "okunamadi";
  const oldest = c.oldestWaitingAt ? Date.parse(c.oldestWaitingAt) : NaN;
  if (c.waiting > 0 && Number.isFinite(oldest) && nowMs - oldest > def.stuckAfterMinutes * 60_000) return "takildi";
  if (c.failed > 0) return "hata";
  if (c.waiting > QUEUE_BACKLOG_WARN) return "birikiyor";
  if (c.waiting === 0) return "bos";
  return "saglikli";
}

/** En eski bekleyen işin yaşı ("12 dk", "3 sa", "2 gün"); gelecekteki (geri çekilmiş) iş için "planlı". */
export function waitAgeLabel(oldestIso: string | null, nowMs: number): string | null {
  if (!oldestIso) return null;
  const t = Date.parse(oldestIso);
  if (!Number.isFinite(t)) return null;
  const min = Math.floor((nowMs - t) / 60_000);
  if (min < 0) return "planlı";
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} sa`;
  return `${Math.floor(h / 24)} gün`;
}

/**
 * Elle yeniden kuyruğa alma güncellemesi (tablo başına): sayaç sıfırlanır, iş hemen alınabilir, kira/ölü mektup
 * işareti temizlenir. Yalnız `retryable` kuyruklar; aksi null.
 */
export function requeuePatch(key: QueueKey, nowIso: string): Record<string, unknown> | null {
  if (key === "public_mutation") {
    return { status: "retry", attempt_count: 0, next_attempt_at: nowIso, dead_lettered_at: null, lease_token: null, lease_started_at: null, updated_at: nowIso };
  }
  if (key === "storage_deletion") {
    return { status: "retry", attempt_count: 0, next_attempt_at: nowIso, updated_at: nowIso };
  }
  return null;
}
