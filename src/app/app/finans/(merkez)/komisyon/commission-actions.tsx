"use client";

import { useState } from "react";
import { cancelPaymentLink, extendPaymentLink, listCommissionPaymentLinks, type PaymentLinkRow } from "@/app/actions/payment-link-manage";
import { trDayKey } from "@/lib/clock";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, Coins, HandCoins, Link2, Loader2, Undo2, XCircle } from "lucide-react";
import { convertWorkflow } from "@/app/actions/workflow";
import { recordCommissionCollection, revertCommissionPayment } from "@/app/actions/commissions";
import type { CommissionPayoutState } from "@/lib/finance/commission-payouts";
import { Input } from "@/components/ui/input";
import { PayoutPayForm } from "./payout-pay-form";
import { createPaymentLink } from "@/app/actions/payment-links";
import { useToast } from "@/components/app/toast-provider";
import { FinanceAccountPicker } from "@/components/app/finance-account-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";

const money2 = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);

export function CommissionActions({
  commissionId,
  amount,
  status,
  payout,
  collection,
}: {
  commissionId: string;
  amount: number;
  status: string;
  /** Hakediş durumu — yalnız ödeme yetkisi olana (owner/gm) verilir. */
  payout?: { state: CommissionPayoutState; payableAmount: number };
  /** Kasaya yazılmış tahsilat (KDV dahil toplam ve net tahsil edilen); yalnız kasa hareketlerini görebilene verilir. */
  collection?: { total: number; collected: number };
}) {
  const { push } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<"paid" | "link" | "revert" | "partial" | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  // Kısmi tahsilat: tutar girilir, kalan gösterilir; hesap "Tahsil et" ile aynı seçiciden.
  const [partialOpen, setPartialOpen] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  // SK6/B109: ofiste hesap varsa hesap zorunlu; hesap yoksa (0) "kasaya yazmadan işaretle" bilinçli onayı.
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [confirmNoCash, setConfirmNoCash] = useState(false);
  const needAccount = accountCount !== null && accountCount > 0 && !accountId;
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

  async function markPaid(skipCash = false) {
    if (needAccount) {
      push("Tahsilatın girdiği hesabı seçin", "err");
      return;
    }
    if (accountCount === 0 && !skipCash) {
      setConfirmNoCash(true);
      return;
    }
    setBusy("paid");
    const fd = new FormData();
    fd.set("action", "mark_commission_paid");
    fd.set("commission_id", commissionId);
    if (accountId) fd.set("account_id", accountId);
    if (skipCash) fd.set("no_cash", "1");
    const res = await convertWorkflow(fd);
    setBusy(null);
    if (res.needsCashConfirm) setConfirmNoCash(true);
    else if (res.error) push(res.error, "err");
    else {
      push("Komisyon tahsil edildi olarak işaretlendi", "ok");
      if (res.info) push(res.info, "err");
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
      if (res.info) push(res.info, "ok");
      router.refresh();
    }
  }

  async function recordPartial() {
    const raw = partialAmount.trim();
    // "1.500,50" (Türkçe) ya da "1500.50": virgül varsa noktalar binlik ayırıcıdır.
    const value = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
    if (!accountId) {
      push("Tahsilatın girdiği hesabı seçin", "err");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      push("Tahsil edilen tutarı girin", "err");
      return;
    }
    setBusy("partial");
    const res = await recordCommissionCollection(commissionId, { accountId, amount: value });
    setBusy(null);
    if (res.error) push(res.error, "err");
    else {
      push(res.fullyCollected ? "Tahsilat tamamlandı · komisyon tahsil edildi" : `Kısmi tahsilat kaydedildi · kalan ${money2(res.remaining ?? 0)}`, "ok");
      setPartialAmount("");
      setPartialOpen(false);
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
  const collected = collection?.collected ?? 0;
  const remaining = collection ? Math.max(0, Math.round((collection.total - collected) * 100) / 100) : null;
  const canRevert = paid || collected > 0;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!paid ? <FinanceAccountPicker value={accountId} onChange={setAccountId} required onAccountsLoaded={setAccountCount} /> : null}
        {!paid ? (
          <ConfirmDialog
            open={confirmNoCash}
            onOpenChange={setConfirmNoCash}
            title="Kasaya yazmadan işaretle"
            description="Ofiste kasa ya da banka hesabı yok. Komisyon tahsil edildi işaretlenir ama kasaya hareket yazılmaz. Hesap açınca Finans > Kasa ve banka sekmesindeki “Kasaya işle” listesinden yazabilirsiniz."
            confirmLabel="Kasaya yazmadan işaretle"
            tone="default"
            onConfirm={() => markPaid(true)}
          />
        ) : null}
        {!paid ? (
          <button
            type="button"
            onClick={() => markPaid()}
            disabled={busy !== null || needAccount}
            title={needAccount ? "Önce tahsilatın girdiği hesabı seçin" : undefined}
            className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--viz-pos)_13%,transparent)] px-2.5 py-1.5 text-xs font-bold text-[color:var(--viz-pos)] transition hover:bg-[color-mix(in_srgb,var(--viz-pos)_22%,transparent)] disabled:opacity-50"
          >
            {busy === "paid" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {collected > 0 ? "Kalanı tahsil et" : "Tahsil et"}
          </button>
        ) : null}
        {!paid && collection && accountCount !== 0 ? (
          <Button type="button" variant="outline" size="xs" icon={Coins} onClick={() => setPartialOpen((v) => !v)} aria-expanded={partialOpen} disabled={busy !== null}>
            Kısmi tahsilat
          </Button>
        ) : null}
        {canRevert ? (
          <ConfirmDialog
            trigger={
              <button
                type="button"
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-bold text-text-muted transition hover:border-[color:var(--viz-5)] hover:text-[color:var(--pm-warn-text)] disabled:opacity-50"
              >
                {busy === "revert" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                Tahsilatı geri al
              </button>
            }
            title="Tahsilatı geri al"
            description="Komisyon “Hesaplandı” durumuna döner ve tahsil edilen tutarlardan düşer; kasaya yazılmış tahsilat hareketleri geri alınır (kapatılmış aya düşen hareket ilk açık ayda ters kayıtla). Hakediş ve rapor rakamları buna göre güncellenir."
            confirmLabel="Geri al"
            tone="danger"
            onConfirm={revertPaid}
          />
        ) : null}
        {paid && payout?.state === "payable" && !payOpen ? (
          <Button type="button" size="sm" icon={HandCoins} disabled={busy !== null} onClick={() => setPayOpen(true)} aria-expanded={payOpen}>
            Hakediş öde
          </Button>
        ) : null}
        {paid && payout?.state === "paid" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--viz-pos)_13%,transparent)] px-2.5 py-1 text-xs font-bold text-[color:var(--viz-pos)]">
            <HandCoins className="h-3.5 w-3.5" /> Hakediş ödendi
          </span>
        ) : null}
        {!paid ? (
          <ConfirmDialog
            trigger={
              <button
                type="button"
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-bold text-accent-text transition hover:border-border-interactive disabled:opacity-50"
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
          className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-bold text-text-muted transition hover:border-border-interactive"
        >
          Linkler <ChevronDown className={`h-3.5 w-3.5 transition ${linksOpen ? "rotate-180" : ""}`} />
        </button>
      </div>
      {!paid && collection && collected > 0 ? (
        <p className="numeric text-xs text-text-muted">
          Tahsil edilen {money2(collected)} · kalan <span className="font-bold text-text">{money2(remaining ?? 0)}</span>
        </p>
      ) : null}
      {partialOpen && !paid && collection ? (
        <div className="flex w-full max-w-[320px] flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-2 text-left">
          <label className="grid flex-1 gap-1 text-xs font-semibold text-text-muted">
            Tahsil edilen tutar (KDV dahil)
            <Input
              inputMode="decimal"
              value={partialAmount}
              onChange={(e) => setPartialAmount(e.target.value)}
              placeholder={`en çok ${money2(remaining ?? 0)}`}
              className="text-xs"
            />
          </label>
          <Button type="button" size="sm" onClick={recordPartial} loading={busy === "partial"} disabled={busy !== null || !accountId}>
            Kaydet
          </Button>
          {!accountId ? <p className="w-full text-xs text-text-faint">Önce tahsilatın girdiği hesabı seçin.</p> : null}
        </div>
      ) : null}
      {paid && payout?.state === "payable" && payOpen ? (
        <PayoutPayForm commissionIds={[commissionId]} total={payout.payableAmount} onClose={() => setPayOpen(false)} />
      ) : null}
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
                  <span className="font-semibold text-text">{l.title}</span>
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
                    <a href={l.url} target="_blank" rel="noreferrer" className="rounded-[var(--radius-control)] border border-line px-2 py-1 font-bold text-accent-text hover:border-border-interactive">
                      Aç
                    </a>
                    <button
                      type="button"
                      disabled={linkBusy !== null}
                      onClick={() => extendLink(l.id)}
                      className="rounded-[var(--radius-control)] border border-line px-2 py-1 font-bold text-text-muted hover:border-border-interactive disabled:opacity-50"
                    >
                      +7 gün
                    </button>
                    <ConfirmDialog
                      trigger={
                        <button
                          type="button"
                          disabled={linkBusy !== null}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 py-1 font-bold text-[color:var(--viz-neg)] hover:border-[color:var(--viz-neg)] disabled:opacity-50"
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
        <a href={linkUrl} target="_blank" rel="noreferrer" className="max-w-[220px] truncate text-xs font-semibold text-accent-text hover:underline">
          {linkUrl}
        </a>
      ) : null}
    </div>
  );
}
