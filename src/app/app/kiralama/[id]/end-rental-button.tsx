"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, XCircle } from "lucide-react";
import { endRental } from "@/app/actions/rentals";
import { useToast } from "@/components/app/toast-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Kirayı sonlandırır — tahakkuk geçmişi silinmez, yalnızca durum kapanır. */
export function EndRentalButton({ rentalId }: { rentalId: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    setBusy(true);
    const res = await endRental(rentalId);
    setBusy(false);
    if (res.error) push(res.error, "err");
    else {
      push("Kira kaydı sonlandırıldı", "ok");
      router.refresh();
    }
  }

  return (
    <ConfirmDialog
      title="Kirayı sonlandır"
      description="Kira kaydı 'Bitti' durumuna alınacak; tahakkuk ve bakım geçmişi korunur. Bitiş tarihi boşsa bugünle doldurulur."
      confirmLabel="Sonlandır"
      onConfirm={onConfirm}
      trigger={
        <button
          type="button"
          disabled={busy}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-danger-500/25 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Kirayı sonlandır
        </button>
      }
    />
  );
}
