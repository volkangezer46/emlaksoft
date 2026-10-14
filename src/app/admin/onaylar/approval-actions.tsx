"use client";

import { InlineOp, opFieldClass } from "@/app/admin/billing/inline-op";
import { StepUpInlineField } from "@/components/admin/step-up";
import { approvePlatformRequest, cancelPlatformRequest, rejectPlatformRequest } from "@/app/actions/platform-approvals";

const lbl = "text-xs font-semibold text-text-muted";

/** Bekleyen talebin satır içi kararları: Onayla (kendi doğrulayıcı kodu) · Reddet (gerekçe) · Geri çek (yalnız talep eden). */
export function ApprovalActions({ id, canDecide, canCancel }: { id: string; canDecide: boolean; canCancel: boolean }) {
  const hidden = { id };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canDecide ? (
        <InlineOp label="Onayla" confirmLabel="Onayla ve yürüt" hidden={hidden} action={approvePlatformRequest} hint="Onayladığınızda işlem sizin adınıza hemen yürür.">
          <label className={lbl}>
            Not (isteğe bağlı)
            <input name="note" maxLength={500} className={`mt-1 block w-64 ${opFieldClass}`} />
          </label>
          <StepUpInlineField labelClassName={lbl} inputClassName={`mt-1 block w-28 tabular-nums ${opFieldClass}`} />
        </InlineOp>
      ) : null}
      {canDecide ? (
        <InlineOp label="Reddet" confirmLabel="Reddet" tone="danger" hidden={hidden} action={rejectPlatformRequest}>
          <label className={lbl}>
            Ret gerekçesi
            <input name="note" required minLength={3} maxLength={500} className={`mt-1 block w-64 ${opFieldClass}`} />
          </label>
        </InlineOp>
      ) : null}
      {canCancel ? <InlineOp label="Geri çek" confirmLabel="Talebi geri çek" hidden={hidden} action={cancelPlatformRequest} /> : null}
    </div>
  );
}
