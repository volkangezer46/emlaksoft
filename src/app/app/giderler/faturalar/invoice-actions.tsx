"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Eye, Pencil, RefreshCw, RotateCcw, Send, Trash2 } from "lucide-react";
import {
  cancelInvoice,
  deleteInvoiceDraft,
  issueInvoice,
  refreshInvoiceStatus,
  reopenInvoice,
  type EInvoiceActionResult,
} from "@/app/actions/einvoice";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Props = {
  id: string;
  status: "draft" | "issued" | "error" | "cancelled";
  canCancel: boolean;
  /** Sağlayıcı test kipinde mi (onay metninde belirtilir). */
  sandbox: boolean;
};

function useRun() {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<EInvoiceActionResult>, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.error) push(res.error, "err");
      else {
        push(res.message ?? "Tamam", "ok");
        after?.();
      }
      router.refresh();
    });
  }
  return { pending, run };
}

export function InvoiceRowActions({ id, status, canCancel, sandbox }: Props) {
  const { pending, run } = useRun();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {status === "draft" ? (
        <>
          <ButtonLink href={`/app/giderler?sekme=faturalar&duzenle=${id}`} variant="secondary" size="sm" icon={Pencil}>
            Kontrol et
          </ButtonLink>
          <ConfirmDialog
            trigger={<Button type="button" variant="ghost" size="sm" icon={Trash2} loading={pending} aria-label="Taslağı sil" />}
            title="Taslak silinsin mi?"
            description="Taslak kalıcı olarak silinir. Sağlayıcıya hiçbir şey gönderilmemiştir."
            confirmLabel="Sil"
            onConfirm={() => run(() => deleteInvoiceDraft(id), () => router.replace("/app/giderler?sekme=faturalar"))}
          />
        </>
      ) : null}
      {status === "issued" ? (
        <>
          <Button type="button" variant="ghost" size="sm" icon={RefreshCw} loading={pending} onClick={() => run(() => refreshInvoiceStatus(id))}>
            Durumu sorgula
          </Button>
          <a
            href={`/api/einvoice/${id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-xs font-semibold text-accent-text hover:underline"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> PDF görüntüle
          </a>
          {canCancel ? (
            <ConfirmDialog
              trigger={<Button type="button" variant="ghost" size="sm" icon={Ban} loading={pending}>İptal et</Button>}
              title="Fatura iptal edilsin mi?"
              description={`Fatura sağlayıcıda iptal edilir${sandbox ? " (test kipi)" : ""}. Bu işlem geri alınamaz.`}
              confirmLabel="Faturayı iptal et"
              onConfirm={() => run(() => cancelInvoice(id, "Ofis tarafından iptal edildi"))}
            />
          ) : null}
        </>
      ) : null}
      {status === "error" ? (
        <Button type="button" variant="secondary" size="sm" icon={RotateCcw} loading={pending} onClick={() => run(() => reopenInvoice(id), () => router.push(`/app/giderler?sekme=faturalar&duzenle=${id}`))}>
          Düzeltip yeniden dene
        </Button>
      ) : null}
    </div>
  );
}

/** Taslak kontrol ekranı: özet + geri alınamaz uyarılı "Resmileştir". */
export function IssuePanel({ id, sandbox, providerName, docTypeLabel, grossLabel }: { id: string; sandbox: boolean; providerName: string; docTypeLabel: string; grossLabel: string }) {
  const { pending, run } = useRun();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 className="font-display text-base font-bold text-ink-950">Kontrol ve resmileştirme</h2>
      <p className="text-sm text-text-muted">
        {providerName} üzerinden <strong className="text-ink-950">{docTypeLabel}</strong> kesilecek, toplam{" "}
        <strong className="numeric text-ink-950">{grossLabel}</strong>. Bilgileri yukarıdan kontrol edin; resmileştirdikten sonra değiştirilemez.
      </p>
      {sandbox ? (
        <p className="rounded-[var(--radius-control)] bg-amber-400/12 px-3 py-2 text-xs font-semibold text-amber-600">
          Test kipi: bu fatura gerçek değildir, mali değeri yoktur.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" icon={Send} loading={pending} onClick={() => setOpen(true)}>
          Resmileştir
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="Fatura resmileştirilsin mi?"
        description={`Bu işlem GERİ ALINAMAZ. Fatura ${providerName} üzerinden gönderilir${sandbox ? " (test kipi)" : " ve resmi belge olur"}. Alıcı bilgilerini ve tutarı kontrol ettiğinizden emin olun.`}
        confirmLabel="Evet, resmileştir"
        onConfirm={() => run(() => issueInvoice(id, true), () => router.replace("/app/giderler?sekme=faturalar"))}
      />
    </section>
  );
}
