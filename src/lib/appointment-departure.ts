/**
 * GA-07 — Randevu öncesi danışman bildirimleri (SAF; DB/ağ yok, cron adımı `appointment-departure-step.ts` kullanır).
 *
 *  - "2 saat kala": randevuya 60–150 dk kalmışken BİR KEZ (dedupe randevu + saat). Cron 30 dk'da bir döndüğü için pencere
 *    geniştir; tekrar önleme anahtarla yapılır. Randevu bu pencereden sonra açıldıysa bildirim üretilmez (24 saat
 *    hatırlatması zaten gitmiştir).
 *  - "Yola çıkma zamanı": danışmanın aynı gün bir ÖNCEKİ koordinatlı randevusundan bu randevunun konumuna kuş uçuşu
 *    yol tahmini (`route-plan.ts`, 40 km/s) + 10 dk pay. Çıkış anı önümüzdeki 30 dk içindeyse (ya da geçtiyse ama
 *    randevu henüz başlamadıysa) bildirim. Başlangıç noktası bilinmiyorsa SAHTE tahmin üretilmez.
 * Metinlerde "~" ve "tahmini" ifadesi zorunlu: kuş uçuşu trafiği bilmez.
 */
import { appointmentReminderRecipient } from "@/lib/appointment-messages";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { formatTrTime, trDayKey } from "@/lib/clock";
import { buildDedupeKey } from "@/lib/notify-dedupe";
import { DEFAULT_DURATION_MIN, haversineKm, travelMinutes } from "@/lib/route-plan";

/** Yola çıkma payı (park, asansör, müşteriyi karşılama). */
export const DEPARTURE_BUFFER_MIN = 10;
/** Cron sıklığı: çıkış anı bu kadar içinde olan randevular bu turda bildirilir. */
export const DEPARTURE_LOOKAHEAD_MS = 30 * 60_000;
/** "2 saat kala" penceresi (dk, (alt, üst]). */
export const TWO_HOUR_WINDOW_MIN = { from: 60, to: 150 } as const;

export type DepartureAppointment = {
  id: string;
  tenant_id: string;
  scheduled_at: string;
  duration_min: number | null;
  appointment_type: string | null;
  status: string | null;
  assigned_to: string | null;
  created_by: string | null;
  customerName: string | null;
  lat: number | null;
  lng: number | null;
};

export type DepartureNotification = {
  tenant_id: string;
  user_id: string;
  title: string;
  body: string;
  href: string;
  kind: "info";
  dedupe_key: string;
};

export function twoHourReminderKey(a: Pick<DepartureAppointment, "id" | "scheduled_at">): string {
  return buildDedupeKey("appt-2saat", a.id, new Date(a.scheduled_at).getTime());
}

export function departureReminderKey(a: Pick<DepartureAppointment, "id" | "scheduled_at">): string {
  return buildDedupeKey("appt-leave", a.id, new Date(a.scheduled_at).getTime());
}

/** "1 sa 40 dk" / "45 dk". */
export function minutesLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} sa ${rest} dk` : `${h} saat`;
}

type Leg = { travelMin: number; fromName: string | null };

/** Aynı danışmanın aynı gün önceki koordinatlı randevusundan bu randevuya tahmini yol (yoksa null). */
export function previousLeg(target: DepartureAppointment, all: readonly DepartureAppointment[]): Leg | null {
  if (target.lat == null || target.lng == null) return null;
  const owner = appointmentReminderRecipient(target);
  if (!owner) return null;
  const startMs = Date.parse(target.scheduled_at);
  const day = trDayKey(startMs);
  let best: DepartureAppointment | null = null;
  for (const a of all) {
    if (a.id === target.id || a.status === "cancelled") continue;
    if (appointmentReminderRecipient(a) !== owner) continue;
    if (a.lat == null || a.lng == null) continue;
    const ms = Date.parse(a.scheduled_at);
    if (!(ms < startMs) || trDayKey(ms) !== day) continue;
    if (!best || ms > Date.parse(best.scheduled_at)) best = a;
  }
  if (!best || best.lat == null || best.lng == null) return null;
  const km = haversineKm(best.lat, best.lng, target.lat, target.lng);
  return { travelMin: travelMinutes(km), fromName: best.customerName };
}

/**
 * Bu cron turunda yazılacak "2 saat kala" ve "yola çıkma" bildirimleri. `all`: danışmanların bugünkü randevuları
 * (başlamış olanlar dahil; başlangıç noktası için). `isAlreadyNotified(key)`: dedupe anahtarı daha önce yazıldı mı.
 */
export function planDepartureReminders(
  all: readonly DepartureAppointment[],
  opts: { nowMs: number; isAlreadyNotified: (key: string) => boolean },
): { rows: DepartureNotification[] } {
  const rows: DepartureNotification[] = [];
  for (const a of all) {
    if (a.status !== "pending" && a.status !== "confirmed" && a.status !== "signature") continue;
    const userId = appointmentReminderRecipient(a);
    if (!userId) continue;
    const startMs = Date.parse(a.scheduled_at);
    if (!Number.isFinite(startMs) || startMs <= opts.nowMs) continue;
    const untilMin = (startMs - opts.nowMs) / 60_000;
    const who = a.customerName?.trim() || "Müşteri";
    const type = appointmentTypeLabel(a.appointment_type ?? "");
    const at = formatTrTime(startMs);
    const href = `/app/randevular?randevu=${a.id}`;

    const leg = previousLeg(a, all);
    if (leg && leg.travelMin > 0) {
      const leaveMs = startMs - (leg.travelMin + DEPARTURE_BUFFER_MIN) * 60_000;
      const key = departureReminderKey(a);
      if (leaveMs <= opts.nowMs + DEPARTURE_LOOKAHEAD_MS && !opts.isAlreadyNotified(key)) {
        const late = leaveMs <= opts.nowMs;
        rows.push({
          tenant_id: String(a.tenant_id),
          user_id: userId,
          title: late ? `Hemen yola çıkın: ${at} ${type.toLocaleLowerCase("tr")}` : `Yola çıkma zamanı: ${formatTrTime(leaveMs)}`,
          body: `${who} · ${at} ${type.toLocaleLowerCase("tr")} · ~${minutesLabel(leg.travelMin)} yol (tahmini, kuş uçuşu)${leg.fromName ? ` · önceki durak: ${leg.fromName}` : ""}. Yol tarifi randevu kartında.`,
          href,
          kind: "info",
          dedupe_key: key,
        });
        continue;
      }
    }

    if (untilMin > TWO_HOUR_WINDOW_MIN.from && untilMin <= TWO_HOUR_WINDOW_MIN.to) {
      const key = twoHourReminderKey(a);
      if (opts.isAlreadyNotified(key)) continue;
      const end = formatTrTime(startMs + (a.duration_min ?? DEFAULT_DURATION_MIN) * 60_000);
      rows.push({
        tenant_id: String(a.tenant_id),
        user_id: userId,
        title: `Randevunuza ~${minutesLabel(untilMin)} kaldı`,
        body: `${who} · ${at}–${end} ${type.toLocaleLowerCase("tr")}. Konum ve yol tarifi randevu kartında.`,
        href,
        kind: "info",
        dedupe_key: key,
      });
    }
  }
  return { rows };
}
