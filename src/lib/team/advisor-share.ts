/**
 * Danışman payı hesabı — tek kaynak (Cüzdanım ve Ekip Merkezi / Kazanç sekmesi).
 *
 * `commissions.splits` jsonb `[{label, rate}]` taşır; satırlarda danışman
 * PROFİL ID'Sİ YOK, taraflar serbest metin etiket (split editörü böyle
 * kaydediyor). Bu yüzden pay üç kademede belirlenir:
 *
 * 1. Etiketi kullanıcının tam adıyla birebir eşleşen split satır(lar)ı varsa
 *    pay = brüt × oran (adına yazılmış paylaşım en güvenilir kaynak).
 * 2. Ad eşleşmesi yoksa ama bağlı anlaşma kullanıcıya atanmışsa
 *    (`deals.assigned_to`), jenerik "Danışman" etiketli satırın oranı kullanılır
 *    (editörün varsayılan şablonu bu etiketi üretir).
 * 3. Paylaşım hiç tanımlanmamışsa ve anlaşma kullanıcıya atanmışsa brüt tutarın
 *    tamamı "paylaşım bekliyor" notuyla gösterilir.
 *
 * Bunların hiçbiri tutmayan kayıtlar danışmanın kazancına girmez.
 * (Kalıcı çözüm: splits satırlarına profile_id — Faz 2.)
 */
export type SplitEntry = { label?: string; amount?: number; rate?: number };

type DealRel = { assigned_to: string | null } | { assigned_to: string | null }[] | null;

export type ShareRow = {
  gross_amount: number | string;
  status: string;
  splits: SplitEntry[] | null;
  deal: DealRel;
};

export function dealOf<T extends { assigned_to: string | null }>(value: T | T[] | null): T | null | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isPaid(status: string) {
  return status === "paid" || status === "collected";
}

export function advisorShare(
  row: Pick<ShareRow, "gross_amount" | "splits" | "deal">,
  fullName: string | null,
  userId: string,
): { amount: number; note: string } | null {
  const gross = Number(row.gross_amount) || 0;
  const assignedToMe = dealOf(row.deal)?.assigned_to === userId;
  const splits = Array.isArray(row.splits) ? row.splits : [];

  if (splits.length > 0) {
    const named = fullName ? splits.filter((s) => s.label === fullName) : [];
    if (named.length > 0) {
      const rate = named.reduce((sum, s) => sum + (Number(s.rate) || 0), 0);
      return { amount: Math.round(gross * (rate / 100)), note: `%${rate} pay` };
    }
    if (assignedToMe) {
      const generic = splits.find((s) => s.label === "Danışman");
      if (generic) {
        const rate = Number(generic.rate) || 0;
        return { amount: Math.round(gross * (rate / 100)), note: `%${rate} pay (Danışman)` };
      }
    }
    return null;
  }

  if (assignedToMe) return { amount: gross, note: "Paylaşım tanımsız · brüt" };
  return null;
}

export type AdvisorEarning = {
  /** Kayıt sayısı (payı olan komisyon satırı). */
  count: number;
  /** Tahsil edilmemiş (calculated) pay toplamı. */
  pending: number;
  /** Tahsil edilmiş (paid/collected) pay toplamı. */
  collected: number;
};

/**
 * Bir danışmanın komisyon satırlarından kazancı: tahmini (bekleyen) ve kesinleşmiş (tahsil).
 * Danışmana ödeme (hakediş) bugün ayrı durum DEĞİL — burada gösterilen müşteriden tahsilattır.
 */
export function summarizeAdvisorEarning(
  rows: readonly ShareRow[],
  fullName: string | null,
  userId: string,
): AdvisorEarning {
  const out: AdvisorEarning = { count: 0, pending: 0, collected: 0 };
  for (const row of rows) {
    const share = advisorShare(row, fullName, userId);
    if (!share) continue;
    out.count += 1;
    if (isPaid(row.status)) out.collected += share.amount;
    else out.pending += share.amount;
  }
  return out;
}
