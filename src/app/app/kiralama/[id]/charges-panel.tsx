"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CalendarPlus, Loader2, Receipt, Undo2 } from "lucide-react";
import { createRentCharge, toggleChargePaid } from "@/app/actions/rentals";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Charge = {
  id: string;
  period: string; // YYYY-MM-DD (ay başı)
  amount: number;
  status: string;
  paid_at: string | null;
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}
function monthLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00`));
}
function dateTimeLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(iso));
}

const STATUS_BADGE: Record<string, { variant: "success" | "warning" | "danger"; label: string }> = {
  paid: { variant: "success", label: "Ödendi" },
  pending: { variant: "warning", label: "Bekliyor" },
  overdue: { variant: "danger", label: "Gecikti" },
};

/**
 * Tahakkuk listesi + manuel dönem tahakkuku. Otomatik tahakkuk cron'dadır
 * (/api/cron/kira-tahakkuk); buradaki buton cron'u beklemeden ya da geçmiş/
 * gelecek bir dönem için elle kayıt açmak içindir — mükerrer dönemi DB'deki
 * unique(rental_id, period) keser, hata Türkçe gösterilir.
 */
export function ChargesPanel({
  rentalId,
  charges,
  canCreate,
  canEdit,
}: {
  rentalId: string;
  charges: Charge[];
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

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

  function toggle(id: string, toPaid: boolean) {
    setBusy(id);
    startTransition(async () => {
      const res = await toggleChargePaid(id, rentalId, toPaid);
      setBusy(null);
      if (res.error) push(res.error, "err");
      else router.refresh();
    });
  }

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Receipt className="h-4 w-4 text-brand-600" /> Kira tahakkukları
          <span className="text-xs font-normal text-text-faint">{charges.length} dönem</span>
        </h2>
        {canCreate ? (
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Tahakkuk dönemi"
              className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
            />
            <Button size="sm" onClick={createCharge} loading={busy === "create"} className="gap-1.5">
              <CalendarPlus className="h-3.5 w-3.5" /> Dönem tahakkuku oluştur
            </Button>
          </div>
        ) : null}
      </div>

      {charges.length === 0 ? (
        <p className="mt-4 rounded-[12px] border border-dashed border-line-strong p-6 text-center text-sm text-text-muted">
          Henüz tahakkuk yok. Aylık tahakkuklar vade gününde otomatik oluşturulur; yukarıdan elle de açabilirsiniz.
        </p>
      ) : (
        <div className="mt-4">
          <TableFrame minWidth={520}>
            <Table>
              <THead>
                <TR>
                  <TH>Dönem</TH>
                  <TH align="right">Tutar</TH>
                  <TH>Durum</TH>
                  <TH>Ödeme tarihi</TH>
                  {canEdit ? <TH align="right"><span className="sr-only">İşlem</span></TH> : null}
                </TR>
              </THead>
              <TBody>
                {charges.map((c) => {
                  const badge = STATUS_BADGE[c.status] ?? STATUS_BADGE.pending;
                  const paid = c.status === "paid";
                  return (
                    <TR key={c.id}>
                      <TD className="font-semibold text-ink-950">{monthLabel(c.period)}</TD>
                      <TD align="right" className="font-bold text-ink-950">{money(Number(c.amount))}</TD>
                      <TD>
                        <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                      </TD>
                      <TD className="text-text-muted">{c.paid_at ? dateTimeLabel(c.paid_at) : "—"}</TD>
                      {canEdit ? (
                        <TD align="right">
                          <button
                            type="button"
                            onClick={() => toggle(c.id, !paid)}
                            disabled={busy === c.id}
                            className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-hairline bg-surface px-2 py-1 text-[11px] font-semibold text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas disabled:opacity-50"
                          >
                            {busy === c.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : paid ? (
                              <Undo2 className="h-3 w-3" />
                            ) : (
                              <Check className="h-3 w-3 text-mint-600" />
                            )}
                            {paid ? "Geri al" : "Ödendi işaretle"}
                          </button>
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableFrame>
        </div>
      )}
    </section>
  );
}
