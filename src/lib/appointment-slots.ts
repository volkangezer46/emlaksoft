/**
 * Yeni randevu formunun "akıllı saat" önerileri — SAF modül (saat dışarıdan verilir; `Date.now()` yok).
 *
 * Danışmanın o günkü dolu aralıklarına (iptal edilmemiş randevular; süresi yoksa 60 dk) çakışmayan, geçmişte
 * kalmayan yarım saatlik başlangıçlardan en çok `limit` tanesi önerilir. Önce alışılmış çapalar (10:00, 14:00, 17:00),
 * dolu olanların yerine en yakın boş yarım saatler gelir. Saatler ofis duvar saatidir (Europe/Istanbul, +03:00).
 */

export type BusyRange = { startMs: number; endMs: number };

/** Ofiste alışılmış randevu saatleri (önce bunlar önerilir). */
export const PREFERRED_SLOTS = ["10:00", "14:00", "17:00"] as const;

const DAY_START_MIN = 9 * 60;
const DAY_END_MIN = 19 * 60;
const STEP_MIN = 30;
/** Şu andan en az bu kadar sonrası önerilir (yola çıkma payı). */
const LEAD_MS = 30 * 60_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" + "HH:MM" (ofis saati) → epoch ms; geçersizse null. */
export function officeSlotMs(date: string, time: string): number | null {
  if (!DATE_RE.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const ms = Date.parse(`${date}T${time}:00+03:00`);
  return Number.isFinite(ms) ? ms : null;
}

/** Randevu satırlarını dolu aralığa çevirir (süre yoksa 60 dk). */
export function busyFromAppointments(rows: { scheduled_at: string; duration_min: number | null }[]): BusyRange[] {
  const out: BusyRange[] = [];
  for (const r of rows) {
    const startMs = Date.parse(r.scheduled_at);
    if (!Number.isFinite(startMs)) continue;
    out.push({ startMs, endMs: startMs + (r.duration_min && r.duration_min > 0 ? r.duration_min : 60) * 60_000 });
  }
  return out;
}

export function freeAppointmentSlots(input: {
  date: string;
  busy: BusyRange[];
  nowMs: number;
  durationMin?: number | null;
  limit?: number;
}): string[] {
  const duration = (input.durationMin && input.durationMin > 0 ? input.durationMin : 60) * 60_000;
  const limit = input.limit ?? 3;
  const free: string[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += STEP_MIN) {
    const time = hhmm(m);
    const start = officeSlotMs(input.date, time);
    if (start == null || start < input.nowMs + LEAD_MS) continue;
    const end = start + duration;
    if (input.busy.some((b) => start < b.endMs && b.startMs < end)) continue;
    free.push(time);
  }
  const picked: string[] = PREFERRED_SLOTS.filter((t) => free.includes(t));
  for (const t of free) {
    if (picked.length >= limit) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked.slice(0, limit).sort();
}
