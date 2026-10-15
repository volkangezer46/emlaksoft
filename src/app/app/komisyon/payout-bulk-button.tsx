"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { payCommissionPayouts } from "@/app/actions/commission-payouts";
import { useToast } from "@/components/app/toast-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const fmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

/**
 * Toplu hakediş ödemesi — bu sayfadaki tahsil edilmiş ve danışman payı ödenmemiş komisyonların tümü.
 * Yalnız owner/gm'e render edilir (sayfa `canPay`); eylem aynı kuralı sunucuda yeniden uygular.
 */
export function PayoutBulkButton({ commissionIds, total }: { commissionIds: string[]; total: number }) {
  const { push } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function payAll() {
    setBusy(true);
    const res = await payCommissionPayouts(commissionIds);
    setBusy(false);
    if (res.error) {
      push(res.error, "err");
      return;
    }
    push(`${res.paidCount ?? 0} hakediş ödendi · ${fmt.format(res.paidAmount ?? 0)}`, "ok");
    if (res.info) push(res.info, "err");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-2.5">
      <span className="text-xs font-semibold text-text-muted">
        Bu sayfada ödenmemiş hakediş: <span className="numeric font-bold text-text">{commissionIds.length} komisyon · {fmt.format(total)}</span>
      </span>
      <ConfirmDialog
        trigger={
          <Button type="button" size="sm" icon={HandCoins} loading={busy} disabled={busy}>
            Hakedişleri öde
          </Button>
        }
        title="Hakedişleri öde"
        description={`${commissionIds.length} komisyondaki danışman payları (${fmt.format(total)}) ödendi olarak kaydedilir ve danışmanlara bildirilir. Ödenmiş hakediş geri alınamaz; kasaya hareket yazılmaz.`}
        confirmLabel="Öde"
        tone="default"
        onConfirm={payAll}
      />
    </div>
  );
}
