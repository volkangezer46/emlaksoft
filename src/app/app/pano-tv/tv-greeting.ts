import { trParts } from "@/lib/clock";
import { timeGreeting } from "@/lib/greeting-name";

/**
 * Pano TV "Bugün" sahnesinin selamı: sitenin geri kalanıyla aynı saat dilimleri (`greeting-name.ts`):
 * 05–11 Günaydın · 12–17 İyi günler · 18–21 İyi akşamlar · 22–04 İyi geceler. Saat Türkiye saatidir.
 */
export function tvGreeting(nowMs: number): string {
  return timeGreeting(trParts(nowMs).hour);
}
