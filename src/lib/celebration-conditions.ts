/**
 * Başarı anı (Celebration) koşulları: yalnız GERÇEK veriyle ve yakın zamanda gerçekleşen olaylarda true.
 * Saf; zaman dışarıdan verilir (clock.ts yardımcılarıyla çağrılır).
 */
import { DAY_MS } from "@/lib/clock";

const RECENT_DAYS = 14;

/** Danışmanın ilk tahsilatı: tam bir tahsil kaydı var ve o kayıt son 14 gün içinde. */
export function isFirstCollectionMoment(paidAtIso: readonly (string | null | undefined)[], nowMs: number): boolean {
  const times = paidAtIso.map((s) => (s ? Date.parse(s) : Number.NaN)).filter((t) => Number.isFinite(t));
  if (times.length !== 1) return false;
  return nowMs - times[0]! >= 0 && nowMs - times[0]! <= RECENT_DAYS * DAY_MS;
}

/** İlk davet ödülü: ödülü yüklenen davet sayısı tam 1. */
export function isFirstInviteRewardMoment(paidInvites: number): boolean {
  return paidInvites === 1;
}

/** Hedef tamamlandı: hedef > 0 ve gerçekleşen >= hedef. */
export function isTargetReachedMoment(actual: number, target: number): boolean {
  return Number.isFinite(actual) && Number.isFinite(target) && target > 0 && actual >= target;
}

/** Kontör paketi satın alındı: son kontör faturası ödenmiş VE yeni (sunucuda hesaplanan `recent`). */
export function isCreditPurchaseMoment(invoice: { status: string } | null, recent: boolean): boolean {
  return invoice?.status === "paid" && recent;
}
