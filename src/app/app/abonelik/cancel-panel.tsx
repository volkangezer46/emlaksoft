"use client";

import { useActionState, useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import {
  requestSubscriptionCancel,
  undoSubscriptionCancel,
  type CancelResult,
} from "@/app/actions/subscription-cancel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField, FormTextarea } from "@/components/ui/form-controls";

const initial: CancelResult = {};

function Result({ state }: { state: CancelResult }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** Abonelik iptali: satır içi onay, dönem sonuna kadar kullanım, geri alınabilir. */
export function CancelPanel({
  canCancel,
  pendingCancel,
  endsAtLabel,
}: {
  canCancel: boolean;
  pendingCancel: boolean;
  /** Dönem sonu tarihi (okunabilir); bilinmiyorsa null. */
  endsAtLabel: string | null;
}) {
  const [cancelState, cancelAction, cancelling] = useActionState(requestSubscriptionCancel, initial);
  const [undoState, undoAction, undoing] = useActionState(undoSubscriptionCancel, initial);
  const [confirming, setConfirming] = useState(false);

  if (!canCancel) {
    return <p className="text-sm text-text-muted">Aboneliği yalnız ofis sahibi veya genel müdür iptal edebilir.</p>;
  }

  if (pendingCancel) {
    return (
      <div className="space-y-3">
        <Alert tone="warning" title="İptal talebiniz var">
          Aboneliğiniz{endsAtLabel ? ` ${endsAtLabel} tarihinde` : " dönem sonunda"} sona erecek; o tarihe kadar tüm özellikleri kullanabilirsiniz.
          Verileriniz silinmez.
        </Alert>
        <form action={undoAction}>
          <Button type="submit" variant="secondary" icon={RotateCcw} loading={undoing}>İptal talebini geri al</Button>
        </form>
        <Result state={undoState} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        İptal ettiğinizde ödenmiş dönemin sonuna kadar kullanmaya devam edersiniz{endsAtLabel ? ` (${endsAtLabel})` : ""}; sonrasında
        hesap askıya alınır. Verileriniz silinmez, dilediğinizde yeniden paket seçebilirsiniz.
      </p>
      {confirming ? (
        <form action={cancelAction} className="space-y-3 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 p-3">
          <FormField label="İptal nedeni (isteğe bağlı)" htmlFor="cancel-reason">
            <FormTextarea id="cancel-reason" name="reason" rows={3} maxLength={500} placeholder="Bize neden ayrıldığınızı yazarsanız ürünü geliştiririz." />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" icon={Ban} loading={cancelling}>Evet, dönem sonunda iptal et</Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Vazgeç</Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="secondary" icon={Ban} onClick={() => setConfirming(true)}>Aboneliği iptal et</Button>
      )}
      <Result state={cancelState} />
    </div>
  );
}
