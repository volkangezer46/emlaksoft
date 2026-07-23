"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Link2, Loader2 } from "lucide-react";
import { convertWorkflow } from "@/app/actions/workflow";
import { createPaymentLink } from "@/app/actions/payment-links";
import { useToast } from "@/components/app/toast-provider";

export function CommissionActions({
  commissionId,
  amount,
  status,
}: {
  commissionId: string;
  amount: number;
  status: string;
}) {
  const { push } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<"paid" | "link" | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  async function markPaid() {
    setBusy("paid");
    const fd = new FormData();
    fd.set("action", "mark_commission_paid");
    fd.set("commission_id", commissionId);
    const res = await convertWorkflow(fd);
    setBusy(null);
    if (res.error) push(res.error, "err");
    else {
      push("Komisyon tahsil edildi olarak işaretlendi", "ok");
      router.refresh();
    }
  }

  async function makeLink() {
    setBusy("link");
    const fd = new FormData();
    fd.set("title", "Komisyon / kaparo");
    fd.set("amount", String(amount));
    fd.set("commission_id", commissionId);
    const res = await createPaymentLink(fd);
    setBusy(null);
    if (res.error || !res.url) {
      push(res.error ?? "Link oluşturulamadı", "err");
      return;
    }
    setLinkUrl(res.url);
    try {
      await navigator.clipboard.writeText(res.url);
      push("Ödeme linki kopyalandı", "ok");
    } catch {
      push("Ödeme linki oluşturuldu", "ok");
    }
  }

  const paid = status === "paid" || status === "collected";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!paid ? (
          <button
            type="button"
            onClick={markPaid}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-[9px] bg-mint-500/15 px-2.5 py-1.5 text-[11px] font-bold text-mint-700 transition hover:bg-mint-500/25 disabled:opacity-50"
          >
            {busy === "paid" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Tahsil et
          </button>
        ) : null}
        <button
          type="button"
          onClick={makeLink}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-[9px] border border-line px-2.5 py-1.5 text-[11px] font-bold text-brand-600 transition hover:border-brand-300 disabled:opacity-50"
        >
          {busy === "link" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          Ödeme linki
        </button>
      </div>
      {linkUrl ? (
        <a href={linkUrl} target="_blank" rel="noreferrer" className="max-w-[220px] truncate text-[10px] font-semibold text-brand-600 hover:underline">
          {linkUrl}
        </a>
      ) : null}
    </div>
  );
}
