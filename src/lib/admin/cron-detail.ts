/**
 * Zamanlanmış iş (cron) ayrıntı satırının İNSAN ÖZETİ — SAF (testli). B192: Sistem > çalışma geçmişinde ham camelCase JSON
 * ('{"retention":…,"objectsRemoved":3}') görünüyordu. Özet: bilinen alanlar Türkçe etiketle ("3 nesne silindi"), sayılar
 * tr-TR biçimiyle, en çok 4 alan; ham JSON yalnız "Ayrıntı" (<details>) altında kalır. Düz metin ayrıntı (ör. uyarı
 * motorunun "3 tetikte · 1 yeni") olduğu gibi özet olur.
 */

/** Sık kullanılan ayrıntı anahtarları → Türkçe etiket (sayının ardından yazılır). */
const KEY_LABELS: Record<string, string> = {
  processed: "işlendi",
  sent: "gönderildi",
  delivered: "teslim edildi",
  failed: "başarısız",
  failures: "başarısız",
  errors: "hata",
  error: "hata",
  skipped: "atlandı",
  total: "toplam",
  count: "kayıt",
  rows: "satır",
  created: "oluşturuldu",
  inserted: "eklendi",
  updated: "güncellendi",
  deleted: "silindi",
  removed: "kaldırıldı",
  objectsRemoved: "nesne silindi",
  expired: "süresi doldu",
  archived: "arşivlendi",
  notified: "bildirim",
  reminded: "hatırlatma",
  warned: "uyarı",
  warnings: "uyarı",
  escalated: "yükseltme",
  escalations: "yükseltme",
  breached: "süre aşımı",
  suspended: "askıya alındı",
  resolved: "çözüldü",
  opened: "açıldı",
  queue: "kuyrukta",
  waiting: "bekliyor",
  remaining: "kalan",
  overdue: "gecikmiş",
  tenants: "ofis",
  announcements: "duyuru",
  invoices: "fatura",
  charged: "tahsil edildi",
  retried: "yeniden denendi",
  truncated: "kırpıldı",
  timedOut: "zaman aşımı",
  retention: "saklama",
};

const NUM = new Intl.NumberFormat("tr-TR");

/** camelCase / snake_case anahtar → küçük harfli sözcükler (sözlükte yoksa). */
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-zçğıöşü0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLocaleLowerCase("tr-TR");
}

function part(key: string, value: unknown): string | null {
  const label = KEY_LABELS[key] ?? humanizeKey(key);
  if (typeof value === "number" && Number.isFinite(value)) return `${NUM.format(value)} ${label}`;
  if (typeof value === "boolean") return value ? label : null;
  if (typeof value === "string" && value.trim() && value.length <= 40) return `${label}: ${value.trim()}`;
  if (Array.isArray(value)) return `${NUM.format(value.length)} ${label}`;
  return null;
}

export type CronDetailView = { summary: string | null; raw: string | null };

/** Ayrıntı → özet + (JSON ise) biçimli ham metin. */
export function cronDetailView(detail: string | null | undefined, maxParts = 4): CronDetailView {
  const text = (detail ?? "").trim();
  if (!text) return { summary: null, raw: null };
  if (!text.startsWith("{")) return { summary: text.length > 160 ? `${text.slice(0, 159)}…` : text, raw: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Kesik JSON (heartbeat 500 karakterde keser): özet çıkarılamaz, ham metin yalnız ayrıntıda.
    return { summary: "Ayrıntı kaydı (kısaltılmış)", raw: text };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { summary: null, raw: text };
  const parts: string[] = [];
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (parts.length >= maxParts) break;
    const p = part(k, v);
    if (p) parts.push(p);
  }
  return { summary: parts.length ? parts.join(", ") : "Ayrıntı kaydı", raw: JSON.stringify(parsed, null, 2) };
}
