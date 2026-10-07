"use client";

import Link from "@/components/ui/smart-link";
import { Wallet } from "lucide-react";
import { maxCreditForInvoice } from "@/lib/try-credits/invoice-credit";
import { TRY_WALLET_LINKS, formatShare, formatTry } from "@/lib/try-credits/view";

/** Sunucunun okuduğu cüzdan özeti (istemci tutar HESAPLAMAZ; yalnız ön izleme gösterir, asıl hesap sunucudadır). */
export type WalletCheckoutInfo = {
  availableTry: number;
  /** Tek faturada kredinin en yüksek payı (0, 1]. */
  maxShare: number;
};

/**
 * "Hesap kredimi kullan" onay kutusu. Seçilince sunucu eylemine `use_credit=1` gider; sunucu bakiyeyi ve pay sınırını
 * yeniden doğrular. `totalTry` (KDV dahil) biliniyorsa ön izleme gösterilir. Kredi yoksa kutu GİZLİ, ama cüzdana bağlantı kalır.
 */
export function WalletCreditToggle({
  wallet,
  checked,
  onChange,
  totalTry,
  disabled = false,
  idPrefix,
}: {
  wallet: WalletCheckoutInfo | null | undefined;
  checked: boolean;
  onChange: (next: boolean) => void;
  totalTry?: number | null;
  disabled?: boolean;
  idPrefix: string;
}) {
  if (!wallet) return null;
  if (!(wallet.availableTry > 0)) return null;
  const preview =
    typeof totalTry === "number" && totalTry > 0
      ? maxCreditForInvoice({ totalTry, availableTry: wallet.availableTry, maxShare: wallet.maxShare })
      : null;
  const id = `${idPrefix}-use-credit`;
  return (
    <div className="mt-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--color-brand-600)]"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-semibold text-ink-950">
            <Wallet className="h-3.5 w-3.5 text-brand-600" /> Hesap kredimi kullan
          </span>
          <span className="block text-text-muted">
            Kullanılabilir {formatTry(wallet.availableTry)}; bir faturada en fazla {formatShare(wallet.maxShare)} kullanılır.
            {preview !== null && preview > 0 ? ` Bu ödemede ${formatTry(preview)} düşülür, kalanı kartla ödenir.` : ""}
          </span>
        </span>
      </label>
      <Link href={TRY_WALLET_LINKS.wallet} className="mt-1 inline-block font-semibold text-brand-600 hover:underline">
        Hesap kredisini aç
      </Link>
    </div>
  );
}
