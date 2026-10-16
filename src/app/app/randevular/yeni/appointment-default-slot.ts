/**
 * Yeni randevunun varsayılan saati (sadeleştirme C17) — SAF (saat dışarıdan verilir).
 *
 * Kural: şimdiden sonraki ilk TAM saat; çalışma saatleri 09:00–19:00 (ofis duvar saati, Europe/Istanbul). Saat 09'dan
 * önceyse bugün 09:00; 19:00'u geçtiyse ertesi gün 09:00. Danışmanın dolu aralıkları verilirse çakışan saatler atlanır
 * (en çok iki gün ileri bakılır; hepsi doluysa ilk aday döner, çakışma uyarısı sunucuda yine çalışır).
 * Eskiden "şimdiden sonraki ilk yarım saat" gece 05:00 gibi anlamsız saatler öneriyordu.
 */
import { DAY_MS, trDayKey, trParts } from "@/lib/clock";
import { officeSlotMs, type BusyRange } from "@/lib/appointment-slots";

export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 19;

function hh(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

export function defaultAppointmentSlot(input: {
  nowMs: number;
  busy?: readonly BusyRange[];
  durationMin?: number;
}): { date: string; time: string } {
  const duration = (input.durationMin && input.durationMin > 0 ? input.durationMin : 60) * 60_000;
  const busy = input.busy ?? [];
  const p = trParts(input.nowMs);
  // Şimdiden sonraki ilk tam saat (tam saatteyse bir sonraki).
  const firstHour = p.hour + 1;
  let first: { date: string; time: string } | null = null;
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    const date = trDayKey(input.nowMs + dayOffset * DAY_MS);
    const startHour = dayOffset === 0 ? Math.max(WORK_START_HOUR, firstHour) : WORK_START_HOUR;
    for (let h = startHour; h <= WORK_END_HOUR; h++) {
      const time = hh(h);
      const start = officeSlotMs(date, time);
      if (start == null || start <= input.nowMs) continue;
      first ??= { date, time };
      const end = start + duration;
      if (!busy.some((b) => start < b.endMs && b.startMs < end)) return { date, time };
    }
  }
  return first ?? { date: trDayKey(input.nowMs + DAY_MS), time: hh(WORK_START_HOUR) };
}
