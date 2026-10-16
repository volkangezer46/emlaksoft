import type { SupabaseClient } from "@supabase/supabase-js";
import { fromKurus, num, toKurus } from "@/lib/finance/party/aging";

/**
 * ALACAK / BORÇ — TEK TANIM (C24, plan ilke 8): "Alacağımız" = bize borcu olan kişi ve firmaların NET bakiyelerinin toplamı
 * (`finance_party_balances.balance > 0`), "Borcumuz" = borçlu olduğumuz carilerin net bakiyeleri. Genel bakıştaki
 * "Alacağımız" kartı ile Alacak ve borç sayfasındaki kart AYNI fonksiyondan hesaplanır; böylece iki ekranda iki farklı
 * rakam görünmez. Kazanç gizliliği (P12) gereği görünmeyen cariler iki yerde de toplamdan çıkar.
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

/**
 * Genel bakış için: cari bakiyelerini okuyup tek tanımla toplar. `isHidden` Alacak ve borç listesindeki gizlilik
 * süzgecinin aynısıdır. Okunamazsa null (kart "—" yerine eski özet rakamına düşmez: yanlış rakam göstermemek için).
 */
export async function loadPartyTotals(
  supabase: SupabaseClient,
  isHidden: (id: string, kind: string | null) => boolean,
): Promise<PartyTotals | null> {
  const { data, error } = await supabase.rpc("finance_party_balances", { p_kind: null, p_q: null });
  if (error || !Array.isArray(data)) return null;
  const rows = (data as Record<string, unknown>[])
    .filter((r) => {
      const id = String(r.party_id ?? "");
      return id && !isHidden(id, typeof r.kind === "string" ? r.kind : null);
    })
    .map((r) => ({ balance: num(r.balance), overdue_amount: num(r.overdue_amount) }));
  return sumPartyBalances(rows);
}
