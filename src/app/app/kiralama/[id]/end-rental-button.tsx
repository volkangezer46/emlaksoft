"use client";

import { buttonClass } from "@/components/ui/button";
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
          className={buttonClass({ variant: "onDark", size: "md", className: "hover:border-danger-400/60 hover:text-danger-300" })}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Kirayı sonlandır
        </button>
      }
    />
  );
}
