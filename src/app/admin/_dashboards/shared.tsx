import { trParts } from "@/lib/clock";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

/** "3 EKİM CUMARTESİ · GENEL BAKIŞ" — Türkiye saatine göre. */
export function adminEyebrow(nowMs: number, suffix = "Genel bakış"): string {
  const p = trParts(nowMs);
  return `${p.day} ${MONTHS[p.month]} ${WEEKDAYS[p.weekday]} · ${suffix}`.toLocaleUpperCase("tr-TR");
}

/** TR saatine göre selamlama. */
export function adminGreeting(nowMs: number): string {
  const hour = trParts(nowMs).hour;
  if (hour >= 5 && hour < 12) return "Günaydın";
  if (hour >= 12 && hour < 18) return "İyi günler";
  if (hour >= 18 && hour < 22) return "İyi akşamlar";
  return "İyi geceler";
}

export function firstNameOf(full: string | null | undefined): string | undefined {
  const n = (full ?? "").trim().split(/\s+/)[0];
  return n ? n : undefined;
}

