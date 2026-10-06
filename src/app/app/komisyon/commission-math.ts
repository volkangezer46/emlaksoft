/**
 * Komisyon sayfasının saf hesapları (DOM/zaman yok). Yalnız gerçek tutarlardan türer.
 * "Geciken" durumu bilinçli YOK: komisyon kaydında vade/son tahsil tarihi tutulmaz;
 * sayfa içi yaşa bakarak üretilen bir geciken oranı sahte olurdu.
 */

export type StatusShares = {
  total: number;
  paid: number;
  pending: number;
  /** Yığılmış çubuk yüzdeleri; toplamı tam 100 (toplam 0 ise ikisi de 0). */
  paidPct: number;
  pendingPct: number;
  /** Tam sayı tahsilat oranı (tahsil / toplam); toplam 0 ise null (sahte %0 yok). */
  collectionRate: number | null;
};

const fin = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Tahsil + bekleyen durum yığını. Negatif/sonlu olmayan tutar 0 sayılır. */
export function statusShares(paidAmount: number, pendingAmount: number): StatusShares {
  const paid = fin(paidAmount);
  const pending = fin(pendingAmount);
  const total = paid + pending;
  if (total === 0) return { total: 0, paid, pending, paidPct: 0, pendingPct: 0, collectionRate: null };
  const paidPct = Math.round((paid / total) * 1000) / 10;
  return {
    total,
    paid,
    pending,
    paidPct,
    pendingPct: Math.round((100 - paidPct) * 10) / 10,
    collectionRate: Math.round((paid / total) * 100),
  };
}

/** Küçük ama sıfırdan büyük dilimler çubukta görünür kalsın (en az `floor` yüzde). */
export function visibleWidths(parts: readonly number[], floor = 2): number[] {
  const total = parts.reduce((s, p) => s + fin(p), 0);
  if (total === 0) return parts.map(() => 0);
  const raw = parts.map((p) => (fin(p) / total) * 100);
  const lifted = raw.map((r) => (r > 0 ? Math.max(floor, r) : 0));
  const sum = lifted.reduce((s, r) => s + r, 0);
  return lifted.map((r) => Math.round((r / sum) * 1000) / 10);
}
