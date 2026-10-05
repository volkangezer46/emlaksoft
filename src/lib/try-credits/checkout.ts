import type { SupabaseClient } from "@supabase/supabase-js";
import type { TryInvoiceHold } from "./config";
import { fromKurus, planInvoiceCredit, toKurus } from "./invoice-credit";
import { tryBalance, tryCreditReady, tryReserve, tryReserveIdem } from "./wallet";

/**
 * Checkout × kredi: fatura taslağı oluştuktan sonra (iyzico açılmadan ÖNCE) rezerv açar.
 * `client` service_role istemcisidir ve ÇAĞIRAN işlevden gelir (bu dosya admin istemcisi YARATMAZ).
 * Kullanıcı "kredimi kullan" dediyse ve kredi uygulanamazsa SESSİZCE tam nakit çekilmez: hata döner,
 * çağıran faturayı başarısız işaretler (markCheckoutInvoiceFailed rezervi de bırakır).
 */

/** Ofis kullanıcısının kredi isteği (onay kutusu). */
export type WalletCreditRequest = {
  userId: string;
  /** Faturada kredinin en yüksek payı (0, 1]; ayardan gelir. */
  maxShare: number;
};

export type AppliedWalletCredit = {
  reservationId: string;
  creditTry: number;
  /** iyzico'dan tahsil edilecek tutar (KDV dahil toplam − kredi). */
  cashTry: number;
  /** Kredi toplamı karşılıyor: iyzico ÇAĞRILMAZ. */
  fullCredit: boolean;
};

export type ApplyCreditResult = { ok: true; applied: AppliedWalletCredit } | { ok: false; error: string };

const MSG = {
  unavailable: "Kredi cüzdanı şu an kullanılamıyor; krediyi seçmeden ödemeye devam edebilirsiniz.",
  none: "Kullanılabilir hesap krediniz yok.",
  changed: "Kredi bakiyeniz değişti; sayfayı yenileyip tekrar deneyin.",
  cap: "Bu faturada uygulanabilecek kredi sınırı aşıldı.",
  invoice: "Fatura krediyle ödeme için uygun değil.",
} as const;

export async function applyWalletCreditToInvoice(
  client: Pick<SupabaseClient, "rpc">,
  input: { tenantId: string; invoiceId: string; totalTry: number; request: WalletCreditRequest },
): Promise<ApplyCreditResult> {
  // Para akışı yalnız tüm SQL (cüzdan + fatura ödeme RPC'leri + fulfill/v2) hazırsa açılır.
  if (!(await tryCreditReady(client))) return { ok: false, error: MSG.unavailable };
  const balance = await tryBalance(client, input.tenantId);
  if (!balance) return { ok: false, error: MSG.unavailable };
  const plan = planInvoiceCredit({
    totalTry: input.totalTry,
    availableTry: balance.available,
    maxShare: input.request.maxShare,
  });
  if (!(plan.creditTry > 0)) return { ok: false, error: MSG.none };

  const reserve = await tryReserve(client, {
    tenantId: input.tenantId,
    userId: input.request.userId,
    amountTry: plan.creditTry,
    idem: tryReserveIdem(input.invoiceId),
    invoiceId: input.invoiceId,
    maxShare: input.request.maxShare,
  });
  if (!reserve) return { ok: false, error: MSG.unavailable };
  if (!reserve.ok) {
    if (reserve.code === "insufficient") return { ok: false, error: MSG.changed };
    if (reserve.code === "over_cap") return { ok: false, error: MSG.cap };
    return { ok: false, error: MSG.invoice };
  }
  if (reserve.state !== "reserved") return { ok: false, error: MSG.invoice };
  // Rezerv satırı esastır (tekrar çağrıda `duplicate` aynı tutarı döner): nakit = toplam − rezerv tutarı.
  const cashK = toKurus(input.totalTry) - toKurus(reserve.amount);
  return {
    ok: true,
    applied: {
      reservationId: reserve.reservation_id,
      creditTry: reserve.amount,
      cashTry: fromKurus(cashK),
      fullCredit: cashK === 0,
    },
  };
}

/**
 * Ödeme doğrulamada iyzico'dan BEKLENEN tutar: fatura toplamı − (varsa) kredi rezervi.
 * Rezerv serbest kalmış olsa bile iyzico oturumu nakit tutarla açıldığı için `cash_try` esastır.
 */
export function expectedProviderAmountTry(totalTry: number, hold: TryInvoiceHold): number {
  if (!hold.has_hold) return totalTry;
  return fromKurus(toKurus(totalTry) - toKurus(hold.amount));
}
