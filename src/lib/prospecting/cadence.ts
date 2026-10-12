import { DAY_MS } from "@/lib/clock";
import { CADENCE_DAYS, CADENCE_REPEAT_DAYS } from "./thresholds";

/**
 * Takip ritmi (SAF; saat dışarıdan gelir). Yeni kayıt aynı gün aranmalı (0. gün); her temastan sonra bir sonraki
 * basamak ilk görülmeden itibaren 3 / 7 / 14 / 21 / 30. gündür. Basamak geçmişte kaldıysa ertesi güne ertelenir
 * (gecikmiş kayıt art arda aynı gün gösterilmez). 6 temastan sonra ayda bir. Kullanıcının "sonra ara: tarih"i önceliklidir.
 */
export function initialNextActionMs(firstSeenMs: number): number {
  return firstSeenMs + CADENCE_DAYS[0] * DAY_MS;
}

export function nextActionAfterContactMs(input: {
  /** Bu temas dahil toplam temas (deneme) sayısı. */
  attemptsAfter: number;
  firstSeenMs: number;
  nowMs: number;
  /** Kullanıcının seçtiği tarih (epoch ms); gelecekteyse ritmi önceler. */
  userNextMs?: number | null;
}): number {
  const { attemptsAfter, firstSeenMs, nowMs, userNextMs } = input;
  if (userNextMs != null && Number.isFinite(userNextMs) && userNextMs > nowMs) return userNextMs;
  const n = Math.max(1, Math.floor(attemptsAfter));
  if (n >= CADENCE_DAYS.length) return nowMs + CADENCE_REPEAT_DAYS * DAY_MS;
  const target = firstSeenMs + CADENCE_DAYS[n] * DAY_MS;
  return target > nowMs ? target : nowMs + DAY_MS;
}
