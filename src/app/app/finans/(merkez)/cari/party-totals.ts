import { fromKurus, toKurus } from "@/lib/finance/party/aging";

/**
 * CARİ NET BAKİYE (Alacak ve borç sayfasının kişi/firma listesi): "Cari net alacak" = bize borcu olan carilerin NET
 * bakiyeleri toplamı (`finance_party_balances.balance > 0`), "Cari net borç" = borçlu olduğumuz carilerin net bakiyeleri.
 * Ofisin genel "Alacağımız / Borcumuz" rakamı bu DEĞİLDİR: o, tüm açık kalemlerin toplamıdır (ana sayfa ve genel bakış;
 * tek tanım `@/lib/finance/receivable-definition`). Kazanç gizliliği (P12) gereği görünmeyen cariler toplamdan çıkar.
 */
export type PartyBalanceLike = { balance: number; overdue_amount: number };

export type PartyTotals = { receivable: number; payable: number; overdue: number; overdueParties: number };

/** Saf: kuruş hassasiyetinde toplar (kayan nokta kayması yok). */
export function sumPartyBalances(rows: readonly PartyBalanceLike[]): PartyTotals {
  let recvK = 0;
  let payK = 0;
  let overdueK = 0;
  let overdueParties = 0;
  for (const r of rows) {
    const b = toKurus(r.balance);
    if (b > 0) recvK += b;
    else payK -= b;
    const o = toKurus(r.overdue_amount);
    if (o > 0) {
      overdueK += o;
      overdueParties += 1;
    }
  }
  return { receivable: fromKurus(recvK), payable: fromKurus(payK), overdue: fromKurus(overdueK), overdueParties };
}
