/**
 * Kontör paketi (meta.kind = 'credit_pack') faturası iadesi: verilen EF kontörü geri alınır (clawback).
 * Saf yardımcılar; cüzdan çağrısı platform-billing.ts'te (ef_credit_reserve + commit, kalem `pack_refund`).
 * Kontör kullanılmışsa (bakiye yetmiyorsa) rezerv `insufficient` döner ve iade ENGELLENİR.
 */

export const EF_PACK_REFUND_ITEM = "pack_refund";

/** İade oranına göre geri alınacak kontör (yukarı yuvarlanır; paket birimini aşmaz). */
export function efPackClawbackUnits(packUnits: number, refundTry: number, totalTry: number): number {
  if (!Number.isFinite(packUnits) || !Number.isFinite(refundTry) || !Number.isFinite(totalTry)) return 0;
  const units = Math.trunc(packUnits);
  if (units <= 0 || refundTry <= 0 || totalTry <= 0) return 0;
  const ratio = Math.min(refundTry / totalTry, 1);
  // Kayan nokta gürültüsü (ör. 100 * 0.3 = 30.000000000000004) yukarı yuvarlamayı bozmasın.
  return Math.min(units, Math.ceil(Math.round(units * ratio * 1e6) / 1e6));
}

/** İdem anahtarı fatura + birimle ilişkilidir (aynı iade tekrarında aynı, farklı tutarda farklı). */
export function efPackRefundIdem(invoiceId: string, units: number): string {
  return `pack-refund-${invoiceId}-${Math.trunc(units)}`;
}
