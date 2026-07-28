"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { respondToOfferByToken } from "@/app/actions/owner-portal-offers";

/**
 * Malik portalı teklif aksiyonları — yalnızca "submitted" durumundaki
 * teklifler için render edilir. Karar geri alınamaz olduğundan iki buton da
 * ConfirmDialog ile onaya bağlıdır; başarıda server action revalidate eder,
 * rozet güncellenir ve butonlar kaybolur.
 */
export function OfferActions({
  token,
  offerId,
  amountLabel,
}: {
  token: string;
  offerId: string;
  amountLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);

  const handle = async (fd: FormData) => {
    setError(null);
    const res = await respondToOfferByToken(fd);
    if (res?.error) setError(res.error);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <ConfirmDialog
          trigger={
            <Button size="sm" className="bg-mint-600 hover:bg-mint-700">
              <Check className="h-3.5 w-3.5" /> Kabul et
            </Button>
          }
          title="Teklifi kabul et"
          description={`${amountLabel} tutarındaki teklif "kabul edildi" olarak işaretlenecek ve danışmanınız süreci başlatacak. Bu işlem geri alınamaz.`}
          confirmLabel="Kabul et"
          cancelLabel="Vazgeç"
          tone="default"
          formAction={handle}
          hiddenFields={{ token, offer_id: offerId, decision: "accepted" }}
        />
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="secondary" className="text-danger-600 hover:bg-danger-500/10">
              <X className="h-3.5 w-3.5" /> Reddet
            </Button>
          }
          title="Teklifi reddet"
          description={`${amountLabel} tutarındaki teklif "reddedildi" olarak işaretlenecek. Bu işlem geri alınamaz.`}
          confirmLabel="Reddet"
          cancelLabel="Vazgeç"
          tone="danger"
          formAction={handle}
          hiddenFields={{ token, offer_id: offerId, decision: "rejected" }}
        />
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-danger-600">{error}</p>}
    </div>
  );
}
