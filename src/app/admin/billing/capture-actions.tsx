"use client";

import { resolveCapture } from "@/app/actions/platform-billing";
import { InlineOp, opFieldClass } from "./inline-op";

/** Mutabakat kuyruğu satır eylemleri. Para hareketi bu ekrandan yapılmaz; durum + denetim kaydı yazılır. */
export function CaptureActions({
  captureId,
  status,
  isSuperAdmin,
}: {
  captureId: string;
  status: string;
  isSuperAdmin: boolean;
}) {
  const hidden = { capture_id: captureId };
  return (
    <div className="flex flex-wrap items-start gap-2 sm:col-span-4">
      {status === "manual_review" || status === "retry_pending" ? (
        <InlineOp
          label="İade gerekli olarak işaretle"
          confirmLabel="İşaretle"
          hidden={{ ...hidden, op: "refund_needed" }}
          action={resolveCapture}
          hint="Tahsilat yerel kayda işlenemiyor ve para sağlayıcıda duruyorsa kullanın."
        />
      ) : null}
      {status === "refund_required" || status === "retry_pending" ? (
        <InlineOp
          label="Manuel incelemeye al"
          confirmLabel="İncelemeye al"
          hidden={{ ...hidden, op: "review" }}
          action={resolveCapture}
        />
      ) : null}
      {status === "refund_required" || status === "manual_review" || status === "retry_pending" ? (
        isSuperAdmin ? (
          <InlineOp
            label="İade edildi"
            confirmLabel="İade edildi olarak kapat"
            tone="danger"
            hidden={{ ...hidden, op: "refunded" }}
            action={resolveCapture}
            hint="Parayı iyzico panelinden/bankadan iade ettikten sonra kullanın; geri alınamaz."
          >
            <label className="text-xs font-semibold text-text-muted">
              İade referansı
              <input name="note" required minLength={3} maxLength={300} placeholder="Örn. iyzico iade no" className={`mt-1 block w-56 ${opFieldClass}`} />
            </label>
          </InlineOp>
        ) : (
          <span className="text-xs text-text-faint">İade kapatma yalnız süper admin.</span>
        )
      ) : null}
    </div>
  );
}
