"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ArrowLeftRight, Printer, Wallet } from "lucide-react";
import { offsetChargeToOwner, recordBuildingPayment, voidBuildingPayment } from "@/app/actions/building-management";
import { useToast } from "@/components/app/toast-provider";
import { FinanceAccountPicker } from "@/components/app/finance-account-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { BUILDING_PAYMENT_METHOD_LABELS, BUILDING_STATUS_LABELS, deriveBuildingChargeStatus, PAYER_LABELS, type BuildingChargeStatus } from "@/lib/building-management/charges";
import { PAYMENT_METHODS, computeLateFee, daysLate, formatReceiptNo, remainingAmount, type LateFeeSettings } from "@/lib/property-management/payments";

export type CollectionCharge = {
  id: string;
  unitId: string;
  unitLabel: string;
  payerRole: "owner" | "tenant";
  payerName: string | null;
  title: string;
  dueDate: string;
  amount: number;
  paid: number;
  /** Malik borcu kira hakedişinden mahsup edilebilir mi (bağlı kira var). */
  offsetPossible: boolean;
};

export type CollectionPayment = {
  id: string;
  chargeId: string;
  amount: number;
  paidOn: string;
  method: string;
  bankNote: string | null;
  receiptNo: number;
  managementFee: number;
  voidedAt: string | null;
  voidReason: string | null;
};

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);
const dayLabel = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));

const STATUS_VARIANT: Record<BuildingChargeStatus, "success" | "warning" | "danger" | "info"> = { paid: "success", pending: "warning", partial: "info", overdue: "danger" };

/**
 * Bina tahsilat paneli: daire bazlı gruplanmış tahakkuklar; kısmi ödeme alma, makbuz, tahsilat iptali, malik borcunu kira
 * hakedişinden mahsup. Gecikme bedeli yalnız ofis ayarı AÇIKSA (varsayılan kapalı) ve bilgi amaçlı gösterilir.
 */
export function CollectionPanel({
  charges,
  payments,
  today,
  lateFee,
  canEdit,
  canDelete,
  canOffset,
  initialUnpaidOnly = true,
}: {
  charges: CollectionCharge[];
  payments: CollectionPayment[];
  today: string;
  lateFee: LateFeeSettings;
  canEdit: boolean;
  canDelete: boolean;
  canOffset: boolean;
  initialUnpaidOnly?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [unpaidOnly, setUnpaidOnly] = useState(initialUnpaidOnly);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [offsetFor, setOffsetFor] = useState<string | null>(null);
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");

  const groups = useMemo(() => {
    const byUnit = new Map<string, { unitId: string; unitLabel: string; items: CollectionCharge[] }>();
    for (const c of charges) {
      if (unpaidOnly && remainingAmount(c.amount, c.paid) === 0) continue;
      const g = byUnit.get(c.unitId) ?? { unitId: c.unitId, unitLabel: c.unitLabel, items: [] };
      g.items.push(c);
      byUnit.set(c.unitId, g);
    }
    return [...byUnit.values()];
  }, [charges, unpaidOnly]);

  function done(msg: string) {
    push(msg, "ok");
    setPayFor(null);
    setOffsetFor(null);
    setVoidFor(null);
    router.refresh();
  }

  function submitPayment(c: CollectionCharge, fd: FormData) {
    setFormError(null);
    setBusy(`pay:${c.id}`);
    startTransition(async () => {
      const res = await recordBuildingPayment({
        chargeId: c.id,
        amount: String(fd.get("amount") ?? ""),
        paidOn: String(fd.get("paid_on") ?? ""),
        method: String(fd.get("method") ?? ""),
        bankNote: String(fd.get("bank_note") ?? ""),
        accountId: accountId || null,
      });
      setBusy(null);
      if (res.info) push(res.info, "err");
      if (res.error) setFormError(res.error);
      else done(res.receiptNo ? `Tahsilat kaydedildi · ${formatReceiptNo(res.receiptNo)}` : "Tahsilat kaydedildi");
    });
  }

  function submitOffset(c: CollectionCharge, fd: FormData) {
    setFormError(null);
    setBusy(`off:${c.id}`);
    startTransition(async () => {
      const res = await offsetChargeToOwner({ chargeId: c.id, amount: String(fd.get("amount") ?? "") });
      setBusy(null);
      if (res.error) setFormError(res.error);
      else done("Malik borcu kira hakedişinden mahsup edildi");
    });
  }

  function submitVoid(paymentId: string, fd: FormData) {
    setFormError(null);
    setBusy(`void:${paymentId}`);
    startTransition(async () => {
      const res = await voidBuildingPayment({ paymentId, reason: String(fd.get("reason") ?? "") });
      setBusy(null);
      if (res.error) setFormError(res.error);
      else done("Tahsilat iptal edildi");
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display font-bold text-ink-950"><Wallet className="h-4 w-4 text-brand-600" /> Tahsilat</h3>
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} className="h-4 w-4 accent-[var(--brand-600)]" />
          Yalnız ödenmemişleri göster
        </label>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong p-6 text-center text-sm text-text-muted">
          {unpaidOnly ? "Ödenmemiş tahakkuk yok." : "Henüz tahakkuk yok. Önce dönem aidatı oluşturun."}
        </p>
      ) : (
        groups.map((g) => {
          const debt = g.items.reduce((s, c) => s + remainingAmount(c.amount, c.paid), 0);
          return (
            <div key={g.unitId} className="rounded-[var(--radius-card)] border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <Link href={`/app/aidat?sekme=cari&daire=${g.unitId}`} className="font-semibold text-ink-950 hover:text-brand-700">{g.unitLabel}</Link>
                <span className="text-xs text-text-muted">Kalan borç <span className="numeric font-bold text-ink-950">{money(debt)}</span></span>
              </div>
              <ul className="divide-y divide-line">
                {g.items.map((c) => {
                  const status = deriveBuildingChargeStatus({ amount: c.amount, paid: c.paid, dueDate: c.dueDate, today });
                  const remaining = remainingAmount(c.amount, c.paid);
                  const late = daysLate({ amount: c.amount, paid: c.paid, dueDate: c.dueDate, today });
                  const fee = computeLateFee({ outstanding: remaining, daysLate: late, settings: lateFee });
                  const own = payments.filter((p) => p.chargeId === c.id);
                  return (
                    <li key={c.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink-950">{c.title}</p>
                          <p className="text-xs text-text-muted">Vade {dayLabel(c.dueDate)} · Ödeyen: {PAYER_LABELS[c.payerRole]}{c.payerName ? ` (${c.payerName})` : ""}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={STATUS_VARIANT[status]} size="sm">{BUILDING_STATUS_LABELS[status]}</Badge>
                          {late > 0 ? <Badge variant="danger" size="sm">{late} gün gecikme</Badge> : null}
                        </div>
                      </div>
                      <dl className="grid grid-cols-3 gap-2 text-sm">
                        <div><dt className="text-xs text-text-muted">Tutar</dt><dd className="numeric font-bold text-ink-950">{money(c.amount)}</dd></div>
                        <div><dt className="text-xs text-text-muted">Ödenen</dt><dd className="numeric font-bold text-mint-600">{money(c.paid)}</dd></div>
                        <div><dt className="text-xs text-text-muted">Kalan</dt><dd className={`numeric font-bold ${remaining > 0 ? "text-ink-950" : "text-text-faint"}`}>{money(remaining)}</dd></div>
                      </dl>
                      {fee > 0 ? (
                        <p className="text-xs text-amber-700">Gecikme bedeli (ofis ayarı: aylık %{lateFee.monthlyPercent}): <span className="numeric font-semibold">{money(fee)}</span> — bilgi amaçlıdır, tahakkuka otomatik eklenmez.</p>
                      ) : null}

                      {canEdit && remaining > 0 ? (
                        payFor === c.id ? (
                          <form action={(fd) => submitPayment(c, fd)} className="space-y-3 rounded-[var(--radius-card)] border border-brand-300/50 bg-canvas p-3" aria-label={`${c.unitLabel} tahsilat formu`}>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <FormField label="Tutar (₺)" htmlFor={`amt-${c.id}`} required hint={`Kalan: ${money(remaining)} — kısmi ödeme girebilirsiniz.`}>
                                <FormInput id={`amt-${c.id}`} name="amount" inputMode="decimal" required defaultValue={String(remaining).replace(".", ",")} />
                              </FormField>
                              <FormField label="Tahsilat tarihi" htmlFor={`date-${c.id}`} required>
                                <FormInput id={`date-${c.id}`} name="paid_on" type="date" required max={today} defaultValue={today} />
                              </FormField>
                              <FormField label="Yöntem" htmlFor={`method-${c.id}`} required>
                                <FormSelect id={`method-${c.id}`} name="method" defaultValue="cash" required>
                                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{BUILDING_PAYMENT_METHOD_LABELS[m]}</option>)}
                                </FormSelect>
                              </FormField>
                              <FormField label="Banka / açıklama" htmlFor={`note-${c.id}`} hint="Dekont no, banka adı veya çek bilgisi (isteğe bağlı).">
                                <FormInput id={`note-${c.id}`} name="bank_note" maxLength={300} />
                              </FormField>
                              <FormField label="Hangi hesaba girdi?" htmlFor={`acc-${c.id}`} hint="İsteğe bağlı: seçerseniz kasa/banka hareketi otomatik yazılır.">
                                <FinanceAccountPicker value={accountId} onChange={setAccountId} />
                              </FormField>
                            </div>
                            <FormError error={formError} />
                            <div className="flex flex-wrap gap-2">
                              <Button type="submit" size="sm" loading={busy === `pay:${c.id}` && pending} icon={Wallet}>Tahsilatı kaydet</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => { setPayFor(null); setFormError(null); }}>Vazgeç</Button>
                            </div>
                          </form>
                        ) : offsetFor === c.id ? (
                          <form action={(fd) => submitOffset(c, fd)} className="space-y-3 rounded-[var(--radius-card)] border border-brand-300/50 bg-canvas p-3" aria-label={`${c.unitLabel} hakedişten mahsup formu`}>
                            <FormField label="Mahsup edilecek tutar (₺)" htmlFor={`off-${c.id}`} required hint={`Kalan: ${money(remaining)}. Tutar malikin kira hakedişinden “aidat kesintisi” olarak düşülür; hakediş bakiyesi negatife inebilir.`}>
                              <FormInput id={`off-${c.id}`} name="amount" inputMode="decimal" required defaultValue={String(remaining).replace(".", ",")} />
                            </FormField>
                            <FormError error={formError} />
                            <div className="flex flex-wrap gap-2">
                              <Button type="submit" size="sm" loading={busy === `off:${c.id}` && pending} icon={ArrowLeftRight}>Hakedişten mahsup et</Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => { setOffsetFor(null); setFormError(null); }}>Vazgeç</Button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" icon={Wallet} onClick={() => { setPayFor(c.id); setOffsetFor(null); setVoidFor(null); setFormError(null); }}>Ödeme al</Button>
                            {canOffset && c.offsetPossible && c.payerRole === "owner" ? (
                              <Button size="sm" variant="ghost" icon={ArrowLeftRight} onClick={() => { setOffsetFor(c.id); setPayFor(null); setVoidFor(null); setFormError(null); }}>Hakedişten mahsup</Button>
                            ) : null}
                          </div>
                        )
                      ) : null}

                      {own.length > 0 ? (
                        <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line bg-canvas text-sm" aria-label="Ödeme geçmişi">
                          {own.map((p) => {
                            const voided = Boolean(p.voidedAt);
                            return (
                              <li key={p.id} className="space-y-2 px-3 py-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className={`min-w-0 ${voided ? "text-text-faint line-through" : "text-ink-950"}`}>
                                    <span className="numeric font-bold">{money(p.amount)}</span>
                                    <span className="ml-2 text-xs text-text-muted">{dayLabel(p.paidOn)} · {BUILDING_PAYMENT_METHOD_LABELS[p.method] ?? p.method} · {formatReceiptNo(p.receiptNo)}</span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {voided ? <Badge variant="outline" size="sm">İptal edildi</Badge> : (
                                      <Link href={`/app/aidat/makbuz/${p.id}`} target="_blank" rel="noreferrer" className="focus-ring press inline-flex h-8 touch:h-11 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 text-xs font-semibold text-ink-950 hover:border-brand-300">
                                        <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Makbuz
                                      </Link>
                                    )}
                                    {!voided && canDelete ? <Button size="sm" variant="ghost" onClick={() => { setVoidFor(voidFor === p.id ? null : p.id); setPayFor(null); setOffsetFor(null); setFormError(null); }}>İptal et</Button> : null}
                                  </div>
                                </div>
                                {p.bankNote ? <p className="text-xs text-text-muted">{p.bankNote}</p> : null}
                                {voided && p.voidReason ? <p className="text-xs text-text-muted">İptal nedeni: {p.voidReason}</p> : null}
                                {voidFor === p.id ? (
                                  <form action={(fd) => submitVoid(p.id, fd)} className="space-y-2 rounded-[var(--radius-control)] bg-surface p-2.5">
                                    <FormField label="İptal nedeni" htmlFor={`reason-${p.id}`} required hint="Denetim kaydına yazılır; tahsilat silinmez, iptal edilir.">
                                      <FormInput id={`reason-${p.id}`} name="reason" required minLength={3} maxLength={300} />
                                    </FormField>
                                    <FormError error={formError} />
                                    <div className="flex gap-2">
                                      <Button type="submit" size="sm" variant="danger" loading={busy === `void:${p.id}` && pending}>Tahsilatı iptal et</Button>
                                      <Button type="button" size="sm" variant="ghost" onClick={() => setVoidFor(null)}>Vazgeç</Button>
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
            </div>
          );
        })
      )}
    </section>
  );
}
