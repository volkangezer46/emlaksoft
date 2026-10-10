/**
 * Hesap bakiyesi hesapları (SAF). Bakiye SAKLANMAZ: açılış + Σ(giriş) - Σ(çıkış), iptal edilenler hariç.
 * Kuruş duyarlığı için tamsayı kuruşla toplanır (float sapması yok). DB karşılığı: finance_account_balances().
 */
export type LedgerLine = { direction: "in" | "out"; amount: number; voided?: boolean | null };

export const toKurus = (n: number): number => Math.round(n * 100);
export const fromKurus = (k: number): number => k / 100;

export function computeBalance(
  opening: number,
  lines: readonly LedgerLine[],
): { balance: number; totalIn: number; totalOut: number; count: number } {
  let inK = 0;
  let outK = 0;
  let count = 0;
  for (const l of lines) {
    if (l.voided) continue;
    count += 1;
    if (l.direction === "in") inK += toKurus(l.amount);
    else outK += toKurus(l.amount);
  }
  return { balance: fromKurus(toKurus(opening) + inK - outK), totalIn: fromKurus(inK), totalOut: fromKurus(outK), count };
}

export type TransferCheck = { ok: true } | { ok: false; error: string };

/** İstemci/sunucu ön doğrulaması; nihai kural RPC'dedir. Bakiye negatife düşebilir (uyarı, engel değil). */
export function checkTransfer(input: {
  fromId: string;
  toId: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
}): TransferCheck {
  if (!input.fromId || !input.toId) return { ok: false, error: "Kaynak ve hedef hesabı seçin." };
  if (input.fromId === input.toId) return { ok: false, error: "Kaynak ve hedef hesap aynı olamaz." };
  if (input.fromCurrency !== input.toCurrency) return { ok: false, error: "Farklı para birimli hesaplar arasında transfer yapılamaz." };
  if (!(input.amount > 0)) return { ok: false, error: "Geçerli bir tutar girin." };
  return { ok: true };
}

/** İşlemden sonra bakiye eksiye düşüyorsa uyarı metni (engellemez). */
export function overdraftWarning(balanceAfter: number): string | null {
  return balanceAfter < 0 ? "Bu işlemle hesap bakiyesi eksiye düşecek." : null;
}
