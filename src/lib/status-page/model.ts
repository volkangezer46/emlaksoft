/**
 * DURUM SAYFASI (SAF, yan etkisiz; /durum, admin ekranı ve test ortak).
 *
 * Erişilebilirlik ölçümü: scripts/sunucu/error-watch.sh 30 sn'de bir /api/health yoklar; kesinti "health_down" kuralının
 * eşiğini aşınca alert_events'e (rule_key='health_down', source='host') açık olay yazar, düzelince kapatır. Kesinti süresi
 * = olayın açıldığı an → kapandığı an (açıksa şimdi). Eşik süresi (varsayılan 2 dk) sayılmaz; kısa dalgalanmalar
 * kesinti değildir. Ölçüm başlangıcından önceki günler "ölçüm yok" gösterilir (sahte %100 yok).
 * Gün sınırı İstanbul saatidir (UTC+3, yaz saati yok).
 */

export const UPTIME_DAYS = 90;
/** error-watch'ın health_down olaylarını alert_events'e yazmaya başladığı an (AD10 kurulumu; ilk sunucu ölçümü). */
export const UPTIME_MEASURED_SINCE = "2026-10-13T18:24:00Z";
/** Kapanan olaylar kamu sayfasında bu kadar gün geriye listelenir. */
export const PAST_INCIDENT_DAYS = 14;

const IST_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

export type IncidentKind = "incident" | "maintenance";
export type IncidentImpact = "minor" | "major" | "critical";
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";
export type MaintenanceStatus = "scheduled" | "in_progress" | "completed";
export type AnyStatus = IncidentStatus | MaintenanceStatus;

export const INCIDENT_STATUSES: readonly IncidentStatus[] = ["investigating", "identified", "monitoring", "resolved"];
export const MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = ["scheduled", "in_progress", "completed"];
export const IMPACTS: readonly IncidentImpact[] = ["minor", "major", "critical"];

export const STATUS_LABEL: Record<AnyStatus, string> = {
  investigating: "İnceleniyor",
  identified: "Neden bulundu",
  monitoring: "İzleniyor",
  resolved: "Çözüldü",
  scheduled: "Planlandı",
  in_progress: "Bakım sürüyor",
  completed: "Tamamlandı",
};

export const IMPACT_LABEL: Record<IncidentImpact, string> = {
  minor: "Performans sorunu",
  major: "Kısmi kesinti",
  critical: "Büyük kesinti",
};

export const KIND_LABEL: Record<IncidentKind, string> = { incident: "Olay", maintenance: "Planlı bakım" };

export function isIncidentKind(v: unknown): v is IncidentKind {
  return v === "incident" || v === "maintenance";
}
export function isImpact(v: unknown): v is IncidentImpact {
  return typeof v === "string" && (IMPACTS as readonly string[]).includes(v);
}
export function statusesFor(kind: IncidentKind): readonly AnyStatus[] {
  return kind === "incident" ? INCIDENT_STATUSES : MAINTENANCE_STATUSES;
}
export function isStatusFor(kind: IncidentKind, v: unknown): v is AnyStatus {
  return typeof v === "string" && (statusesFor(kind) as readonly string[]).includes(v);
}
export function isClosedStatus(s: AnyStatus): boolean {
  return s === "resolved" || s === "completed";
}

export type Outage = { start: string; end: string | null };

export type UptimeDay = {
  /** İstanbul takvim günü (YYYY-AA-GG). */
  day: string;
  /** Kesinti saniyesi (ölçülen pencere içinde). */
  downSec: number;
  /** Ölçülen saniye (gün içinde ölçüm başlangıcından ve şimdiden sınırlı). */
  coveredSec: number;
  /** Erişilebilirlik yüzdesi; ölçüm yoksa null. */
  pct: number | null;
  level: "ok" | "minor" | "major" | "none";
};

const istDay = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

/** İstanbul gününün UTC başlangıcı (ms). */
function istDayStart(ms: number): number {
  const shifted = ms + IST_OFFSET_MS;
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - IST_OFFSET_MS;
}

/** Kesinti aralıklarından son `days` günün (eskiden yeniye) günlük erişilebilirliği. */
export function dailyUptime(outages: readonly Outage[], nowMs: number, days = UPTIME_DAYS, measuredSince = UPTIME_MEASURED_SINCE): UptimeDay[] {
  const since = new Date(measuredSince).getTime();
  const intervals = outages
    .map((o) => ({ s: new Date(o.start).getTime(), e: o.end ? new Date(o.end).getTime() : nowMs }))
    .filter((o) => Number.isFinite(o.s) && Number.isFinite(o.e) && o.e > o.s);
  const todayStart = istDayStart(nowMs);
  const out: UptimeDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = todayStart - i * DAY_MS;
    const from = Math.max(dayStart, Number.isFinite(since) ? since : dayStart);
    const to = Math.min(dayStart + DAY_MS, nowMs);
    const covered = Math.max(0, to - from);
    let down = 0;
    if (covered > 0) {
      for (const o of intervals) down += Math.max(0, Math.min(o.e, to) - Math.max(o.s, from));
      down = Math.min(down, covered);
    }
    const pct = covered > 0 ? ((covered - down) / covered) * 100 : null;
    const downSec = Math.round(down / 1000);
    out.push({
      day: istDay(dayStart),
      downSec,
      coveredSec: Math.round(covered / 1000),
      pct,
      level: pct === null ? "none" : downSec === 0 ? "ok" : downSec >= 30 * 60 ? "major" : "minor",
    });
  }
  return out;
}

/** Dönem erişilebilirliği (ölçülen sürenin ağırlıklı yüzdesi); hiç ölçüm yoksa null. */
export function overallUptime(days: readonly UptimeDay[]): number | null {
  const covered = days.reduce((s, d) => s + d.coveredSec, 0);
  if (covered <= 0) return null;
  const down = days.reduce((s, d) => s + d.downSec, 0);
  return ((covered - down) / covered) * 100;
}

/** "%99,95" — 100'e yuvarlanıp kesintiyi gizlememek için aşağı yuvarlar (iki ondalık). */
export function formatUptime(pct: number | null): string {
  if (pct === null) return "Ölçüm yok";
  const floored = Math.floor(pct * 100) / 100;
  return `%${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: floored === 100 ? 0 : 2, maximumFractionDigits: 2 }).format(floored)}`;
}

/** Süre metni: "45 sn", "12 dk", "1 sa 5 dk". */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.round(sec))} sn`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

export type PublicIncident = {
  id: string;
  kind: IncidentKind;
  title: string;
  impact: IncidentImpact;
  status: AnyStatus;
  startedAt: string;
  resolvedAt: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  updates: { status: AnyStatus; message: string; at: string }[];
};

export type OverallLevel = "operational" | "maintenance" | "degraded" | "partial" | "major" | "unknown";

export const OVERALL_LABEL: Record<OverallLevel, string> = {
  operational: "Tüm sistemler çalışıyor",
  maintenance: "Planlı bakım sürüyor",
  degraded: "Performans sorunu yaşanıyor",
  partial: "Kısmi kesinti yaşanıyor",
  major: "Büyük kesinti yaşanıyor",
  unknown: "Durum bilgisi şu an okunamıyor",
};

/** Bakım şu an sürüyor mu: durum "in_progress" ya da (planlı ve pencere içinde). */
export function maintenanceActive(i: Pick<PublicIncident, "kind" | "status" | "scheduledStart" | "scheduledEnd">, nowMs: number): boolean {
  if (i.kind !== "maintenance" || i.status === "completed") return false;
  if (i.status === "in_progress") return true;
  const s = i.scheduledStart ? new Date(i.scheduledStart).getTime() : NaN;
  const e = i.scheduledEnd ? new Date(i.scheduledEnd).getTime() : NaN;
  return Number.isFinite(s) && Number.isFinite(e) && nowMs >= s && nowMs < e;
}

/**
 * Genel durum: açık olayların en ağır etkisi; olay yokken ölçülen kesinti açıksa "Kısmi kesinti", bakım sürüyorsa
 * "Planlı bakım", aksi halde "Tüm sistemler çalışıyor". Veri okunamadıysa "unknown" (sahte yeşil yok).
 */
export function overallStatus(input: { incidents: readonly PublicIncident[]; outageOpen: boolean; nowMs: number; readable: boolean }): OverallLevel {
  if (!input.readable) return "unknown";
  const open = input.incidents.filter((i) => i.kind === "incident" && !isClosedStatus(i.status));
  if (open.some((i) => i.impact === "critical")) return "major";
  if (open.some((i) => i.impact === "major") || input.outageOpen) return "partial";
  if (open.length > 0) return "degraded";
  if (input.incidents.some((i) => maintenanceActive(i, input.nowMs))) return "maintenance";
  return "operational";
}

/** datetime-local girdisi (İstanbul saati, "YYYY-AA-GGTSS:DD") → ISO; geçersizse null. */
export function parseIstanbulLocal(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS;
  const back = new Date(ms + IST_OFFSET_MS);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return new Date(ms).toISOString();
}

/** ISO → datetime-local değeri (İstanbul saati). */
export function toIstanbulLocal(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t + IST_OFFSET_MS).toISOString().slice(0, 16) : "";
}
