"use client";

import { useState } from "react";
import { cancelPaymentLink, extendPaymentLink, listCommissionPaymentLinks, type PaymentLinkRow } from "@/app/actions/payment-link-manage";
import { trDayKey } from "@/lib/clock";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, Link2, Loader2, Undo2, XCircle } from "lucide-react";
import { convertWorkflow } from "@/app/actions/workflow";
import { revertCommissionPayment } from "@/app/actions/commissions";
import { createPaymentLink } from "@/app/actions/payment-links";
import { useToast } from "@/components/app/toast-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
  const [busy, setBusy] = useState<"paid" | "link" | "revert" | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  // Satır içi "Ödeme linkleri" paneli (popup yok): liste, iptal, süre uzatma.
  const [linksOpen, setLinksOpen] = useState(false);
  const [links, setLinks] = useState<PaymentLinkRow[] | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

  async function loadLinks() {
    const res = await listCommissionPaymentLinks(commissionId);
    if (res.error) push(res.error, "err");
    else setLinks(res.links ?? []);
  }

  async function toggleLinks() {
    const next = !linksOpen;
    setLinksOpen(next);
    if (next) await loadLinks();
  }

  async function cancelLink(id: string) {
    if (linkBusy) return;
    setLinkBusy(id);
    const res = await cancelPaymentLink(id);
    setLinkBusy(null);
    if (res.error) push(res.error, "err");
    else {
      push("Ödeme linki iptal edildi", "ok");
      await loadLinks();
      router.refresh();
    }
  }

  async function extendLink(id: string) {
    if (linkBusy) return;
    setLinkBusy(id);
    const res = await extendPaymentLink(id, 7);
    setLinkBusy(null);
    if (res.error) push(res.error, "err");
    else {
      push("Link süresi 7 gün uzatıldı", "ok");
      await loadLinks();
    }
  }

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

  // Yanlış tıklamayla tahsil edilen komisyonu geri alır (denetim P0: geri dönüş yoktu).
  async function revertPaid() {
    setBusy("revert");
    const res = await revertCommissionPayment(commissionId);
    setBusy(null);
    if (res.error) push(res.error, "err");
    else {
      push("Tahsilat geri alındı · kayıt yeniden “Hesaplandı”", "ok");
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
            className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-mint-500/15 px-2.5 py-1.5 text-xs font-bold text-mint-700 transition hover:bg-mint-500/25 disabled:opacity-50"
          >
            {busy === "paid" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Tahsil et
          </button>
        ) : (
          <ConfirmDialog
            trigger={
              <button
                type="button"
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-bold text-text-muted transition hover:border-amber-400 hover:text-amber-600 disabled:opacity-50"
              >
                {busy === "revert" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                Tahsilatı geri al
              </button>
            }
            title="Tahsilatı geri al"
            description="Komisyon “Hesaplandı” durumuna döner ve tahsil edilen tutarlardan düşer. Hakediş ve rapor rakamları buna göre güncellenir."
            confirmLabel="Geri al"
            tone="danger"
            onConfirm={revertPaid}
          />
        )}
        {!paid ? (
          <ConfirmDialog
            trigger={
              <button
                type="button"
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-bold text-brand-600 transition hover:border-brand-300 disabled:opacity-50"
              >
                {busy === "link" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                Ödeme linki
              </button>
            }
            title="Ödeme linki oluştur"
            description={`${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(amount)} ₺ tutarında 7 gün geçerli bir ödeme linki oluşturulur. Link açıkken kazanmayı geri alamazsınız; gerekirse "Linkler" bölümünden iptal edebilirsiniz.`}
            confirmLabel="Link oluştur"
            tone="default"
            onConfirm={makeLink}
          />
        ) : null}
        <button
          type="button"
          onClick={toggleLinks}
          aria-expanded={linksOpen}
          className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-bold text-text-muted transition hover:border-brand-300"
        >
          Linkler <ChevronDown className={`h-3.5 w-3.5 transition ${linksOpen ? "rotate-180" : ""}`} />
        </button>
      </div>
      {linksOpen ? (
        <ul className="w-full min-w-[240px] max-w-[320px] space-y-1.5 rounded-[var(--radius-card)] border border-line bg-canvas p-2 text-left" aria-label="Ödeme linkleri">
          {links === null ? (
            <li className="px-1 py-1 text-xs text-text-muted">Yükleniyor…</li>
          ) : links.length === 0 ? (
            <li className="px-1 py-1 text-xs text-text-muted">Bu komisyon için ödeme linki yok.</li>
          ) : (
            links.map((l) => (
              <li key={l.id} className="rounded-[var(--radius-control)] bg-surface p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink-950">{l.title}</span>
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-bold text-text-muted">
                    {{ open: "Açık", paid: "Ödendi", cancelled: "İptal", expired: "Süresi doldu" }[l.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-text-muted">
                  {new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(l.amount)} ₺
                  {l.expiresAt ? ` · son gün ${trDayKey(l.expiresAt)}` : ""}
                </p>
                {l.status === "open" ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <a href={l.url} target="_blank" rel="noreferrer" className="rounded-[var(--radius-control)] border border-line px-2 py-1 font-bold text-brand-600 hover:border-brand-300">
                      Aç
                    </a>
                    <button
                      type="button"
                      disabled={linkBusy !== null}
                      onClick={() => extendLink(l.id)}
                      className="rounded-[var(--radius-control)] border border-line px-2 py-1 font-bold text-text-muted hover:border-brand-300 disabled:opacity-50"
                    >
                      +7 gün
                    </button>
                    <ConfirmDialog
                      trigger={
                        <button
                          type="button"
                          disabled={linkBusy !== null}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 py-1 font-bold text-danger-500 hover:border-danger-500 disabled:opacity-50"
                        >
                          <XCircle className="h-3 w-3" /> İptal et
                        </button>
                      }
                      title="Ödeme linkini iptal et"
                      description="Link artık ödeme alamaz. Ödeme alınmışsa iptal edilemez."
                      confirmLabel="İptal et"
                      onConfirm={() => cancelLink(l.id)}
                    />
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
      {linkUrl ? (
        <a href={linkUrl} target="_blank" rel="noreferrer" className="max-w-[220px] truncate text-xs font-semibold text-brand-600 hover:underline">
          {linkUrl}
        </a>
      ) : null}
    </div>
  );
}
