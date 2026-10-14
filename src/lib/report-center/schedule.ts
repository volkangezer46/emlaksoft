/**
 * Zamanlanmış rapor aboneliği — SAF kurallar (DG4). Sunucu/istemci bağımlılığı yok: action doğrulaması, cron teslim adımı
 * ve arayüz aynı işlevleri kullanır.
 *
 * Zaman modeli: tüm günler Türkiye takvim günüdür (`YYYY-AA-GG`). `next_run_at` = teslim gününün TR gece yarısı;
 * teslim mevcut `gunluk-ozet` cron'unda (her gün 10:00 TR) yapılır, yani zamanı gelen abonelik o günün özet turunda gider.
 * Aynı dönem iki kez gönderilmez (dönem anahtarı = teslim günü; `report_subscription_runs` tekil).
 */
import { z } from "zod";
import { TR_OFFSET_MS } from "@/lib/clock";
import { REPORT_FORMATS, type Filters, type ReportDef, type ReportFormat } from "./types";

export type SubscriptionFrequency = "daily" | "weekly" | "monthly";
export const SUBSCRIPTION_FREQUENCIES: readonly SubscriptionFrequency[] = ["daily", "weekly", "monthly"];
export const FREQUENCY_LABELS: Record<SubscriptionFrequency, string> = { daily: "Günlük", weekly: "Haftalık", monthly: "Aylık" };

/** ISO hafta günü (1 = Pazartesi ... 7 = Pazar). */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

/** Abonelik başına en çok alıcı (DB CHECK ile aynı). */
export const SUBSCRIPTION_RECIPIENT_MAX = 10;
/** Kişi başına en çok abonelik (kötüye kullanım ve cron bütçesi). */
export const SUBSCRIPTION_PER_OWNER_MAX = 20;
/** Teslim saati bilgisi (arayüz metni; cron `gunluk-ozet` 07:00 UTC). */
export const DELIVERY_HOUR_LABEL = "10:00";

export type ScheduleSpec = { frequency: SubscriptionFrequency; weekday: number | null; monthDay: number | null };

const DAY = 86_400_000;

function keyToUtcMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function utcMsToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(key: string, n: number): string {
  return utcMsToKey(keyToUtcMs(key) + n * DAY);
}

/** ISO hafta günü (1 = Pazartesi). */
export function isoWeekday(key: string): number {
  const d = new Date(keyToUtcMs(key)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** TR gününün başlangıcı (UTC ISO) — `next_run_at` değeri. */
export function runDayStartIso(key: string): string {
  return new Date(keyToUtcMs(key) - TR_OFFSET_MS).toISOString();
}

/** UTC anının TR takvim günü. */
export function trKeyOf(ms: number): string {
  return utcMsToKey(ms + TR_OFFSET_MS);
}

function matches(spec: ScheduleSpec, key: string): boolean {
  if (spec.frequency === "daily") return true;
  if (spec.frequency === "weekly") return isoWeekday(key) === spec.weekday;
  return Number(key.slice(8, 10)) === spec.monthDay;
}

/** `afterKey`'den SONRAKİ (dahil değil) ilk teslim günü. Ay günü 1-28 olduğundan her ay vardır. */
export function nextRunDay(spec: ScheduleSpec, afterKey: string): string {
  let key = addDays(afterKey, 1);
  for (let i = 0; i < 400; i++) {
    if (matches(spec, key)) return key;
    key = addDays(key, 1);
  }
  return key;
}

/**
 * Göreli dönem (abonelik "her gönderimde dönemi yenile" seçiliyse tarih filtresi bununla kurulur):
 * günlük = dün, haftalık = son 7 gün (dün dahil), aylık = önceki takvim ayı.
 */
export function periodRange(frequency: SubscriptionFrequency, dueKey: string): { from: string; to: string } {
  const yesterday = addDays(dueKey, -1);
  if (frequency === "daily") return { from: yesterday, to: yesterday };
  if (frequency === "weekly") return { from: addDays(dueKey, -7), to: yesterday };
  const firstOfDue = `${dueKey.slice(0, 7)}-01`;
  const lastPrev = addDays(firstOfDue, -1);
  return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
}

/** Raporda `from`/`to` tarih aralığı alanı var mı (göreli dönem yalnız bu raporlarda anlamlı). */
export function hasDateRange(def: Pick<ReportDef, "filters">): boolean {
  return def.filters.some((f) => f.key === "from" && f.kind === "date") && def.filters.some((f) => f.key === "to" && f.kind === "date");
}

/** Teslimde kullanılacak filtreler: kayıtlı filtreler + (göreli dönemse) dönemin tarih aralığı. */
export function scheduledFilters(
  def: Pick<ReportDef, "filters">,
  filters: Filters,
  sub: { frequency: SubscriptionFrequency; relativeRange: boolean },
  dueKey: string,
): Filters {
  if (!sub.relativeRange || !hasDateRange(def)) return { ...filters };
  return { ...filters, ...periodRange(sub.frequency, dueKey) };
}

/**
 * Zamanlanabilir rapor mu? Platform raporları her zaman. Kiracı raporlarında yalnız SORGU kaynaklı olanlar: teslim
 * oturumsuz (cron) çalışır ve kiracı + aktör kapsamı sorgunun kendisinde AÇIK süzgeçtir (`export-data-scope-contract`
 * her sorguyu çalıştırıp doğrular). Hesaplanan raporlar oturum JWT'sine dayalı RPC'ler kullanabildiği için zamanlanmaz.
 */
export function isSchedulable(def: Pick<ReportDef, "scope" | "source">): boolean {
  return def.scope === "platform" || def.source.kind === "query";
}

/** "Her Pazartesi", "Her ayın 3'ü", "Her gün". */
export function scheduleLabel(spec: ScheduleSpec): string {
  if (spec.frequency === "daily") return "Her gün";
  if (spec.frequency === "weekly") return `Her ${WEEKDAY_LABELS[spec.weekday ?? 1] ?? "hafta"}`;
  return `Her ayın ${spec.monthDay ?? 1}. günü`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Abonelik formu girdisi (sunucu action'ı doğrular; filtreler ayrıca rapor tanımıyla `parseFilters`'tan geçer). */
export const subscriptionInputSchema = z
  .object({
    reportId: z.string().regex(/^[a-z0-9-]{1,80}$/, "Rapor bulunamadı."),
    name: z.string().trim().min(1, "Abonelik adı zorunlu.").max(80, "Abonelik adı en fazla 80 karakter olabilir."),
    format: z.enum(REPORT_FORMATS as unknown as [ReportFormat, ...ReportFormat[]], { message: "Dosya biçimi seçin." }),
    frequency: z.enum(["daily", "weekly", "monthly"], { message: "Sıklık seçin." }),
    weekday: z.coerce.number().int().min(1).max(7).nullable().optional(),
    monthDay: z.coerce.number().int().min(1).max(28).nullable().optional(),
    recipientIds: z
      .array(z.string().regex(UUID, "Geçersiz alıcı."))
      .min(1, "En az bir alıcı seçin.")
      .max(SUBSCRIPTION_RECIPIENT_MAX, `En çok ${SUBSCRIPTION_RECIPIENT_MAX} alıcı seçebilirsiniz.`),
    relativeRange: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.frequency === "weekly" && !v.weekday) ctx.addIssue({ code: "custom", message: "Haftanın gününü seçin.", path: ["weekday"] });
    if (v.frequency === "monthly" && !v.monthDay) ctx.addIssue({ code: "custom", message: "Ayın gününü seçin (1-28).", path: ["monthDay"] });
  })
  .transform((v) => ({
    ...v,
    recipientIds: [...new Set(v.recipientIds.map((id) => id.toLowerCase()))],
    weekday: v.frequency === "weekly" ? (v.weekday ?? null) : null,
    monthDay: v.frequency === "monthly" ? (v.monthDay ?? null) : null,
  }));

export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;
