/**
 * Daire CARİ EKSTRESİ (SAF). Bakiye SAKLANMAZ; tahakkuk ve (iptal edilmemiş) tahsilatlardan türer.
 *  - Borç (tahakkuk) bakiyeyi artırır, alacak (tahsilat) azaltır.
 *  - Bakiye pozitif = daire borçlu; negatif = fazla ödeme (alacak).
 * Aynı gün içinde önce tahakkuk, sonra tahsilat sıralanır. Tüm toplamlar kuruş (tam sayı) üzerindendir.
 */
import { fromKurus, toKurus } from "@/lib/property-management/payments";

export type CariCharge = { id: string; date: string; amount: number; label: string };
export type CariPayment = { id: string; date: string; amount: number; label: string; receiptNo?: number | null };

export type CariEntry = {
  id: string;
  date: string;
  kind: "charge" | "payment";
  label: string;
  debit: number;
  credit: number;
  /** Bu satırdan sonraki kümülatif bakiye (pozitif = borç). */
  balance: number;
};

export type UnitCari = {
  entries: CariEntry[];
  totals: { charged: number; paid: number; balance: number };
  hasData: boolean;
};

export function computeUnitCari(input: { charges: readonly CariCharge[]; payments: readonly CariPayment[] }): UnitCari {
  type Raw = { id: string; date: string; kind: "charge" | "payment"; label: string; amountK: number };
  const raw: Raw[] = [
    ...input.charges.map((c) => ({ id: c.id, date: c.date.slice(0, 10), kind: "charge" as const, label: c.label, amountK: toKurus(c.amount) })),
    ...input.payments.map((p) => ({
      id: p.id,
      date: p.date.slice(0, 10),
      kind: "payment" as const,
      label: p.receiptNo ? `${p.label} (makbuz ${p.receiptNo})` : p.label,
      amountK: toKurus(p.amount),
    })),
  ];
  raw.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "charge" ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  let running = 0;
  let chargedK = 0;
  let paidK = 0;
  const entries: CariEntry[] = raw.map((r) => {
    if (r.kind === "charge") {
      running += r.amountK;
      chargedK += r.amountK;
    } else {
      running -= r.amountK;
      paidK += r.amountK;
    }
    return {
      id: `${r.kind}:${r.id}`,
      date: r.date,
      kind: r.kind,
      label: r.label,
      debit: r.kind === "charge" ? fromKurus(r.amountK) : 0,
      credit: r.kind === "payment" ? fromKurus(r.amountK) : 0,
      balance: fromKurus(running),
    };
  });
  return {
    entries,
    totals: { charged: fromKurus(chargedK), paid: fromKurus(paidK), balance: fromKurus(chargedK - paidK) },
    hasData: entries.length > 0,
  };
}

export const CARI_NOTE =
  "Cari = tahakkuk edilen aidat/gider − tahsilatlar. Pozitif bakiye dairenin borcu, negatif bakiye fazla ödemedir. İptal edilen tahsilatlar ve iptal edilen tahakkuklar yer almaz.";

export function cariBalanceLabel(balance: number): string {
  const k = toKurus(balance);
  if (k > 0) return "Daire borcu";
  if (k < 0) return "Fazla ödeme (alacak)";
  return "Borç yok";
}
