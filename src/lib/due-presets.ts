/**
 * GA-04 hazır vade seçenekleri — SAF (istemci + sunucu; saat Türkiye saatiyle, `clock.ts`).
 * Görev formu, düzenleme paneli, randevu formu, toplu "Vadeyi taşı", kaydırma "Yarın" ve arama kuyruğu "Atla (yarın)"
 * AYNI hesaptan geçer; sunucu eylemi (`rescheduleTasks`) istemci saatine güvenmez, ön ayar adını alır.
 */
import { DAY_MS, toTrLocalInput, trDayStartMs, trParts } from "@/lib/clock";

export const DUE_PRESETS = ["today18", "tomorrow10", "monday10", "nextweek"] as const;
export type DuePreset = (typeof DUE_PRESETS)[number];

export const DUE_PRESET_LABELS: Readonly<Record<DuePreset, string>> = {
  today18: "Bugün 18:00",
  tomorrow10: "Yarın 10:00",
  monday10: "Pazartesi 10:00",
  nextweek: "+1 hafta",
};

export function isDuePreset(v: unknown): v is DuePreset {
  return typeof v === "string" && (DUE_PRESETS as readonly string[]).includes(v);
}

const HOUR = 3_600_000;

/**
 * Ön ayarın anı (epoch ms). `baseMs`: yalnız "+1 hafta" için mevcut vade (yoksa yarın değil, bugünden 7 gün sonra 10:00).
 * "Bugün 18:00" geçtiyse null (seçenek gösterilmez). "Pazartesi" bugün pazartesiyse gelecek haftanınki.
 */
export function duePresetMs(preset: DuePreset, nowMs: number, baseMs?: number | null): number | null {
  const today = trDayStartMs(nowMs);
  switch (preset) {
    case "today18": {
      const t = today + 18 * HOUR;
      return t > nowMs ? t : null;
    }
    case "tomorrow10":
      return today + DAY_MS + 10 * HOUR;
    case "monday10": {
      const wd = trParts(nowMs).weekday;
      const delta = (1 - wd + 7) % 7 || 7;
      return today + delta * DAY_MS + 10 * HOUR;
    }
    case "nextweek": {
      if (baseMs != null && Number.isFinite(baseMs) && baseMs > nowMs) return baseMs + 7 * DAY_MS;
      return today + 7 * DAY_MS + 10 * HOUR;
    }
  }
}

/** `datetime-local` değeri ("YYYY-MM-DDTHH:mm", TR) ya da geçmişse null. */
export function duePresetLocal(preset: DuePreset, nowMs: number, baseMs?: number | null): string | null {
  const ms = duePresetMs(preset, nowMs, baseMs);
  return ms == null ? null : toTrLocalInput(ms);
}
