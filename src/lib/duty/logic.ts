/**
 * Ofis nöbet çizelgesi (OA7) — SAF karar katmanı (veri çekmez, saat okumaz; zaman parametre gelir).
 *
 * Dilimler (TR duvar saati): tam gün; sabah 08:00–13:00; öğleden sonra 13:00–20:00. "Şu an nöbetçi" = bugünün
 * kaydında saatine uyan dilimdeki danışmanlar. Gün anahtarı "YYYY-MM-DD" (TR günü).
 */

export const DUTY_SLOTS = ["tam", "sabah", "ogle"] as const;
export type DutySlot = (typeof DUTY_SLOTS)[number];

export const DUTY_SLOT_LABELS: Record<DutySlot, string> = {
  tam: "Tam gün",
  sabah: "Sabah (08–13)",
  ogle: "Öğleden sonra (13–20)",
};

export const DUTY_SLOT_SHORT: Record<DutySlot, string> = { tam: "Tam gün", sabah: "Sabah", ogle: "Öğleden sonra" };

export function isDutySlot(v: unknown): v is DutySlot {
  return typeof v === "string" && (DUTY_SLOTS as readonly string[]).includes(v);
}

export type DutyShift = { id?: string; profile_id: string; duty_date: string; slot: DutySlot | string };

/** TR saatine (0–23) göre geçerli dilimler. Mesai dışında (20:00–08:00) yalnız tam gün nöbetçisi sayılır. */
export function activeSlotsAt(trHour: number): DutySlot[] {
  if (trHour >= 8 && trHour < 13) return ["tam", "sabah"];
  if (trHour >= 13 && trHour < 20) return ["tam", "ogle"];
  return ["tam"];
}

/** Gün + saat için nöbetçi profil kimlikleri (tekil, giriş sırası). */
export function onDutyIds(shifts: readonly DutyShift[], dayKey: string, trHour: number): string[] {
  const slots = new Set<string>(activeSlotsAt(trHour));
  const out: string[] = [];
  for (const s of shifts) {
    if (s.duty_date !== dayKey || !slots.has(String(s.slot))) continue;
    if (!out.includes(s.profile_id)) out.push(s.profile_id);
  }
  return out;
}

const DAY_MS = 86_400_000;
const isDayKey = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function addDays(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Haftanın pazartesisi (gün anahtarı). Geçersiz girişte verilen yedek. */
export function weekStartOf(dayKey: string, fallback: string): string {
  const key = isDayKey(dayKey) ? dayKey : fallback;
  const dow = (new Date(`${key}T12:00:00.000Z`).getUTCDay() + 6) % 7; // pazartesi = 0
  return addDays(key, -dow);
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * Dengeli dağıtım: boş günlere (pazar hariç, varsayılan) tam gün nöbetçi atar. Sıra, mevcut haftada en az nöbeti olan
 * üyeden başlar; izinli üye o gün atlanır; aynı kişi arka arkaya iki gün verilmez (başka uygun üye varsa).
 * Dönüş: eklenecek kayıtlar (mevcutlar değişmez).
 */
export function balancedFill(args: {
  days: readonly string[];
  members: readonly string[];
  existing: readonly DutyShift[];
  isOnLeave: (profileId: string, dayKey: string) => boolean;
  skipSunday?: boolean;
}): { profile_id: string; duty_date: string; slot: DutySlot }[] {
  const load = new Map<string, number>(args.members.map((m) => [m, 0]));
  for (const s of args.existing) if (load.has(s.profile_id)) load.set(s.profile_id, (load.get(s.profile_id) ?? 0) + 1);
  const filled = new Set(args.existing.map((s) => s.duty_date));
  const out: { profile_id: string; duty_date: string; slot: DutySlot }[] = [];
  let previous: string | null = null;
  for (const day of args.days) {
    const sunday = new Date(`${day}T12:00:00.000Z`).getUTCDay() === 0;
    if ((args.skipSunday ?? true) && sunday) {
      previous = null;
      continue;
    }
    if (filled.has(day)) {
      previous = args.existing.find((s) => s.duty_date === day)?.profile_id ?? null;
      continue;
    }
    const available = args.members.filter((m) => !args.isOnLeave(m, day));
    if (available.length === 0) {
      previous = null;
      continue;
    }
    const ranked = [...available].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || args.members.indexOf(a) - args.members.indexOf(b));
    const pick = ranked.find((m) => m !== previous) ?? ranked[0]!;
    out.push({ profile_id: pick, duty_date: day, slot: "tam" });
    load.set(pick, (load.get(pick) ?? 0) + 1);
    previous = pick;
  }
  return out;
}
