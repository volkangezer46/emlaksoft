"use client";

import { useState } from "react";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PayoutPayForm } from "./payout-pay-form";

const fmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

/**
 * Toplu hakediş ödemesi — bu sayfadaki tahsil edilmiş ve danışman payı ödenmemiş komisyonların tümü. Ödeme bir ofis
 * hesabından yapılır (zorunlu) ve deftere stopajlı `payout.paid` olarak yazılır (PayoutPayForm).
 * Yalnız owner/gm'e render edilir (sayfa `canPay`); eylem aynı kuralı sunucuda yeniden uygular.
 */
export function PayoutBulkButton({ commissionIds, total }: { commissionIds: string[]; total: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-2.5">
      <span className="text-xs font-semibold text-text-muted">
        Bu sayfada ödenmemiş hakediş: <span className="numeric font-bold text-text">{commissionIds.length} komisyon · {fmt.format(total)}</span>
      </span>
      {open ? (
        <PayoutPayForm commissionIds={commissionIds} total={total} onClose={() => setOpen(false)} />
      ) : (
        <Button type="button" size="sm" icon={HandCoins} onClick={() => setOpen(true)} aria-expanded={open}>
          Hakedişleri öde
        </Button>
      )}
    </div>
  );
}
