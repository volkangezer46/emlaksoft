"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { deleteManualDraft, issueManualInvoice, sendInvoiceEmail } from "@/app/actions/platform-invoices";
import { InlineOp } from "../../inline-op";
import type { LedgerStatusFilter } from "@/lib/accounting/ledger";

/** Taslak silinince fatura defterinin "Taslak" süzgecine dönülür (durum değeri defterin süzgeç listesiyle tip-denetimli). */
const DRAFTS_LEDGER_HREF = `/admin/billing/defter?${new URLSearchParams({ donem: "tumu", durum: "draft" satisfies LedgerStatusFilter })}`;

/** Fatura belgesi işlemleri: elle taslağı kes/sil, e-postayla (yeniden) gönder, yazdır / PDF olarak kaydet. */
export function DocumentActions({
  invoiceId,
  canIssue,
  canDelete,
  canEmail,
  totalLabel,
  dueDays,
}: {
  invoiceId: string;
  canIssue: boolean;
  canDelete: boolean;
  canEmail: boolean;
  totalLabel: string;
  dueDays: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hidden = { invoice_id: invoiceId };

  return (
    <div className="flex flex-wrap items-start gap-2">
      {canIssue ? (
        <InlineOp
          label="Faturayı kes"
          confirmLabel="Kes ve ofise aç"
          hidden={hidden}
          action={issueManualInvoice}
          hint={`Toplam ${totalLabel}. Kesilince ofisin Abonelik ekranında açık fatura olarak görünür; vade ${dueDays} gün sonra.`}
        />
      ) : null}
      {canDelete ? (
        confirmDelete ? (
          <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 p-2">
            <span className="text-xs text-danger-600">Taslak ve kalemleri silinir.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-danger-500/30 text-danger-600"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await deleteManualDraft(toFd(hidden));
                  if (res.error) {
                    setError(res.error);
                    return;
                  }
                  router.replace(DRAFTS_LEDGER_HREF);
                })
              }
            >
              {pending ? "Siliniyor…" : "Taslağı sil"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmDelete(false)}>
              Vazgeç
            </Button>
          </span>
        ) : (
          <Button type="button" variant="outline" size="sm" className="border-danger-500/30 text-danger-600" onClick={() => setConfirmDelete(true)}>
            Taslağı sil
          </Button>
        )
      ) : null}
      {canEmail ? (
        <InlineOp
          label="E-postayla gönder"
          confirmLabel="Ofis sahibine gönder"
          hidden={hidden}
          action={sendInvoiceEmail}
          hint="Fatura dökümü ofis sahibinin e-posta adresine düz metin olarak gider. E-posta kanalı kapalıysa gönderilmez ve denetim kaydına 'kanal kapalı' düşer."
        />
      ) : null}
      <PrintButton tone="outline" size="sm" label="Yazdır / PDF olarak kaydet" />
      {error ? (
        <p role="alert" className="w-full text-xs font-semibold text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function toFd(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}
