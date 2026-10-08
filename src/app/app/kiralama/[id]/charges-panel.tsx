"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { Check, CalendarPlus, Printer, Receipt, Undo2, Wallet } from "lucide-react";
import { createRentCharge, toggleChargePaid } from "@/app/actions/rentals";
import { recordRentPayment, voidRentPayment } from "@/app/actions/rental-finance";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { trMonthKey } from "@/lib/clock";
import {
  CHARGE_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  chargeDueDate,
  computeLateFee,
  daysLate,
  formatReceiptNo,
  remainingAmount,
  type ChargeStatus,
  type LateFeeSettings,
  type PaymentMethod,
} from "@/lib/property-management/payments";

type Charge = {
  id: string;
  period: string; // YYYY-MM-DD (ay başı)
  amount: number;
  status: string;
  paid_at: string | null;
  paid_amount: number;
};

export type ChargePayment = {
  id: string;
  chargeId: string;
  amount: number;
  paidOn: string;
  method: string;
  bankNote: string | null;
  receiptNo: number;
  managementFee: number;
  legacy: boolean;
  voidedAt: string | null;
  voidReason: string | null;
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);
}
function monthLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00`));
}
function dayLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));
}

const STATUS_VARIANT: Record<ChargeStatus, "success" | "warning" | "danger" | "info"> = {
  paid: "success",
  pending: "warning",
  partial: "info",
  overdue: "danger",
};

/**
 * Tahakkuk & tahsilat: her tahakkukta ödenen/kalan, gecikme günü (ofis ayarı açıksa gecikme bedeli), ödeme geçmişi ve
 * "Ödeme al" formu (kısmi ödeme, yöntem, banka/açıklama; makbuz no otomatik). Ödeme iptali silmez; neden zorunludur.
 * Tahsilat kayıtları etkin değilse (migration yok) eski "Ödendi işaretle" akışı gösterilir.
 */
export function ChargesPanel({
  rentalId,
  dueDay,
  today,
  charges,
  payments,
  paymentsAvailable,
  lateFee,
  canCreate,
  canEdit,
  canDelete,
}: {
  rentalId: string;
  dueDay: number;
  /** TR günü (sunucuda hesaplanır; bileşende saat okunmaz). */
  today: string;
  charges: Charge[];
  payments: ChargePayment[];
  paymentsAvailable: boolean;
  lateFee: LateFeeSettings;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [month, setMonth] = useState(() => trMonthKey());
  const [payFor, setPayFor] = useState<string | null>(null);
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function createCharge() {
    setBusy("create");
    startTransition(async () => {
      const res = await createRentCharge(rentalId, month);
      setBusy(null);
      if (res.error) push(res.error, "err");
      else {
        push("Dönem tahakkuku oluşturuldu", "ok");
        router.refresh();
      }
    });
  }

  function legacyToggle(id: string, toPaid: boolean) {
    setBusy(id);
    startTransition(async () => {
      const res = await toggleChargePaid(id, rentalId, toPaid);
      setBusy(null);
      if (res.error) push(res.error, "err");
      else router.refresh();
    });
  }

  function submitPayment(charge: Charge, fd: FormData) {
    setFormError(null);
    setBusy(`pay:${charge.id}`);
    startTransition(async () => {
      const res = await recordRentPayment({
        chargeId: charge.id,
        rentalId,
        amount: String(fd.get("amount") ?? ""),
        paidOn: String(fd.get("paid_on") ?? ""),
        method: String(fd.get("method") ?? ""),
        bankNote: String(fd.get("bank_note") ?? ""),
      });
      setBusy(null);
      if (res.error) {
        setFormError(res.error);
        return;
      }
      push(res.receiptNo ? `Tahsilat kaydedildi · ${formatReceiptNo(res.receiptNo)}` : "Tahsilat kaydedildi", "ok");
      setPayFor(null);
      router.refresh();
    });
  }

  function submitVoid(paymentId: string, fd: FormData) {
    setFormError(null);
    setBusy(`void:${paymentId}`);
    startTransition(async () => {
      const res = await voidRentPayment({ paymentId, rentalId, reason: String(fd.get("reason") ?? "") });
      setBusy(null);
      if (res.error) {
        setFormError(res.error);
        return;
      }
      push("Tahsilat iptal edildi", "ok");
      setVoidFor(null);
      router.refresh();
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Receipt className="h-4 w-4 text-brand-600" /> Tahakkuk &amp; tahsilat
          <span className="text-xs font-normal text-text-faint">{charges.length} dönem</span>
        </h2>
        {canCreate ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Tahakkuk dönemi"
              className="rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400 touch:min-h-11"
            />
            <Button size="sm" onClick={createCharge} loading={busy === "create"} icon={CalendarPlus}>
              Dönem tahakkuku oluştur
            </Button>
          </div>
        ) : null}
      </div>

      {charges.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong p-6 text-center text-sm text-text-muted">
          Henüz tahakkuk yok. Aylık tahakkuklar vade gününde otomatik oluşturulur; yukarıdan elle de açabilirsiniz.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {charges.map((c) => {
            const status = (c.status in CHARGE_STATUS_LABELS ? c.status : "pending") as ChargeStatus;
            const remaining = remainingAmount(c.amount, c.paid_amount);
            const dueDate = chargeDueDate(c.period, dueDay);
            const late = daysLate({ amount: c.amount, paid: c.paid_amount, dueDate, today });
            const fee = computeLateFee({ outstanding: remaining, daysLate: late, settings: lateFee });
            const own = payments.filter((p) => p.chargeId === c.id);
            const open = payFor === c.id;
            return (
              <li key={c.id} className="rounded-[var(--radius-card)] border border-line bg-canvas p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-950">{monthLabel(c.period)}</p>
                    <p className="text-xs text-text-muted">Vade: {dayLabel(dueDate)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[status]} size="sm">{CHARGE_STATUS_LABELS[status]}</Badge>
                    {late > 0 ? <Badge variant="danger" size="sm">{late} gün gecikme</Badge> : null}
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-text-muted">Tutar</dt>
                    <dd className="numeric font-bold text-ink-950">{money(c.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">Ödenen</dt>
                    <dd className="numeric font-bold text-mint-600">{money(c.paid_amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">Kalan</dt>
                    <dd className={`numeric font-bold ${remaining > 0 ? "text-ink-950" : "text-text-faint"}`}>{money(remaining)}</dd>
                  </div>
                </dl>
                {fee > 0 ? (
                  <p className="mt-2 text-xs text-amber-700">
                    Gecikme bedeli (ofis ayarı: aylık %{lateFee.monthlyPercent}): <span className="numeric font-semibold">{money(fee)}</span> — bilgi amaçlıdır, tahakkuka otomatik eklenmez.
                  </p>
                ) : null}

                {paymentsAvailable && canEdit && remaining > 0 ? (
                  <div className="mt-3">
                    {open ? (
                      <form
                        action={(fd) => submitPayment(c, fd)}
                        className="space-y-3 rounded-[var(--radius-card)] border border-brand-300/50 bg-surface p-3"
                        aria-label={`${monthLabel(c.period)} tahsilat formu`}
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField label="Tutar (₺)" htmlFor={`amt-${c.id}`} required hint={`Kalan: ${money(remaining)} — kısmi ödeme girebilirsiniz.`}>
                            <FormInput id={`amt-${c.id}`} name="amount" inputMode="decimal" required defaultValue={String(remaining).replace(".", ",")} />
                          </FormField>
                          <FormField label="Tahsilat tarihi" htmlFor={`date-${c.id}`} required>
                            <FormInput id={`date-${c.id}`} name="paid_on" type="date" required max={today} defaultValue={today} />
                          </FormField>
                          <FormField label="Yöntem" htmlFor={`method-${c.id}`} required>
                            <FormSelect id={`method-${c.id}`} name="method" defaultValue="cash" required>
                              {PAYMENT_METHODS.map((m) => (
                                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                              ))}
                            </FormSelect>
                          </FormField>
                          <FormField label="Banka / açıklama" htmlFor={`note-${c.id}`} hint="Dekont no, banka adı veya çek bilgisi (isteğe bağlı).">
                            <FormInput id={`note-${c.id}`} name="bank_note" maxLength={300} />
                          </FormField>
                        </div>
                        <FormError error={formError} />
                        <div className="flex flex-wrap gap-2">
                          <Button type="submit" size="sm" loading={busy === `pay:${c.id}`} icon={Wallet}>Tahsilatı kaydet</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setPayFor(null); setFormError(null); }}>Vazgeç</Button>
                        </div>
                      </form>
                    ) : (
                      <Button size="sm" variant="outline" icon={Wallet} onClick={() => { setPayFor(c.id); setVoidFor(null); setFormError(null); }}>
                        Ödeme al
                      </Button>
                    )}
                  </div>
                ) : null}

                {!paymentsAvailable && canEdit ? (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      icon={status === "paid" ? Undo2 : Check}
                      loading={busy === c.id}
                      onClick={() => legacyToggle(c.id, status !== "paid")}
                    >
                      {status === "paid" ? "Geri al" : "Ödendi işaretle"}
                    </Button>
                  </div>
                ) : null}

                {own.length > 0 ? (
                  <ul className="mt-3 divide-y divide-line rounded-[var(--radius-control)] border border-line bg-surface text-sm" aria-label="Ödeme geçmişi">
                    {own.map((p) => {
                      const voided = Boolean(p.voidedAt);
                      return (
                        <li key={p.id} className="space-y-2 px-3 py-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className={`min-w-0 ${voided ? "text-text-faint line-through" : "text-ink-950"}`}>
                              <span className="numeric font-bold">{money(p.amount)}</span>
                              <span className="ml-2 text-xs text-text-muted">
                                {dayLabel(p.paidOn)} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method} · {formatReceiptNo(p.receiptNo)}
                                {p.legacy ? " · eski kayıt" : ""}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {voided ? <Badge variant="outline" size="sm">İptal edildi</Badge> : null}
                              {!voided ? (
                                <Link
                                  href={`/app/kiralama/${rentalId}/makbuz/${p.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="focus-ring press inline-flex h-8 touch:h-11 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 text-xs font-semibold text-ink-950 hover:border-brand-300"
                                >
                                  <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Makbuz
                                </Link>
                              ) : null}
                              {!voided && canDelete ? (
                                <Button size="sm" variant="ghost" onClick={() => { setVoidFor(voidFor === p.id ? null : p.id); setPayFor(null); setFormError(null); }}>
                                  İptal et
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          {p.bankNote ? <p className="text-xs text-text-muted">{p.bankNote}</p> : null}
                          {voided && p.voidReason ? <p className="text-xs text-text-muted">İptal nedeni: {p.voidReason}</p> : null}
                          {voidFor === p.id ? (
                            <form action={(fd) => submitVoid(p.id, fd)} className="space-y-2 rounded-[var(--radius-control)] bg-canvas p-2.5">
                              <FormField label="İptal nedeni" htmlFor={`reason-${p.id}`} required hint="Denetim kaydına yazılır; tahsilat silinmez, iptal edilir.">
                                <FormInput id={`reason-${p.id}`} name="reason" required minLength={3} maxLength={300} />
                              </FormField>
                              <FormError error={formError} />
                              <div className="flex gap-2">
                                <Button type="submit" size="sm" variant="danger" loading={busy === `void:${p.id}`}>Tahsilatı iptal et</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => { setVoidFor(null); setFormError(null); }}>Vazgeç</Button>
                              </div>
                            </form>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
