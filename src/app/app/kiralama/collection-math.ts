/**
 * Kiralama "Bu ayın tahsilatı" dağılımı (SAF). SK6/B107: bu ayın 'overdue' durumuna geçmiş tahakkuklarının KALAN tutarı
 * eskiden hiçbir dilime girmiyordu; oran tahsil / (tahsil + bekleyen) hesaplanıyor ve %78 gibi yüksek görünüyordu.
 * Doğru oran: tahsil edilen / bu dönemin TOPLAM tahakkuku (ör. 137.300 / 322.000 → %43).
 *
 * Etiketler (B108): "Gecikmiş (7+ gün)" = durum 'overdue' (kira-tahakkuk cron'u vadeden 7+ gün sonra işaretler);
 * "Vadesi geçen" = vadesi bugünden önce olan her açık tahakkuk (toleranssız; Cari ekranındaki tanım).
 */
export type PeriodCollection = {
  paid: number;
  /** Bekleyen (pending/partial) kalan. */
  pending: number;
  /** Bu dönemin 'overdue' tahakkuklarının kalan tutarı. */
  overdue: number;
  /** Bu dönemin tahakkuk toplamı; bilinmiyorsa dilimlerin toplamı. */
  total: number;
  /** Tahsil / tahakkuk yüzdesi (tam sayı); tahakkuk yoksa null. */
  rate: number | null;
};

export const OVERDUE_7D_LABEL = "Gecikmiş (7+ gün)";

export function periodCollection(input: { paid: number; pending: number; overdue: number; total?: number | null }): PeriodCollection {
  const paid = Math.max(0, input.paid);
  const pending = Math.max(0, input.pending);
  const overdue = Math.max(0, input.overdue);
  const total = input.total != null && Number.isFinite(input.total) && input.total > 0 ? input.total : paid + pending + overdue;
  return { paid, pending, overdue, total, rate: total > 0 ? Math.round((paid / total) * 100) : null };
}
