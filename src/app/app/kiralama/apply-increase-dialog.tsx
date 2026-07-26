"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, TrendingUp } from "lucide-react";
import { applyRentIncrease } from "@/app/actions/rentals";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { FormField, Input } from "@/components/ui/input";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

/**
 * Yenileme radarındaki "Artışı uygula" dialogu.
 *
 * Önerilen yeni kira TÜFE tavanından gelir (düzenlenebilir); tavan aşımında
 * uyarı gösterilir ve uygulama engellenir. Onay ConfirmDialog ile alınır —
 * action tarafı (applyRentIncrease) tavanı sunucuda da doğrular.
 */
export function ApplyIncreaseDialog({
  rentalId,
  propertyName,
  currentRent,
  suggestedRent,
  appliedRate,
  renewalDate,
}: {
  rentalId: string;
  propertyName: string;
  currentRent: number;
  suggestedRent: number;
  appliedRate: number;
  renewalDate: string; // YYYY-MM-DD
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [rent, setRent] = useState<string>(String(suggestedRent));
  const [date, setDate] = useState<string>(renewalDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rentNum = Number(rent);
  const validRent = rentNum > currentRent;
  const overCap = rentNum > suggestedRent;
  const canApply = validRent && !overCap && !!date && !pending;

  const confirm = () =>
    startTransition(async () => {
      const res = await applyRentIncrease(rentalId, rentNum, date);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      push("Kira artışı uygulandı", "ok");
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" /> Artışı uygula
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader
          icon={<TrendingUp />}
          title="Kira artışını uygula"
          description={`${propertyName} — TÜFE tavanına göre önerilen oran %${appliedRate.toFixed(2)}.`}
        />
        <DialogBody className="space-y-4">
          <div className="flex items-center justify-center gap-3 rounded-[12px] border border-line bg-canvas p-3 text-sm">
            <span className="font-semibold text-text-muted">{money(currentRent)}</span>
            <ArrowRight className="h-4 w-4 text-brand-600" />
            <span className="font-bold text-ink-950">{validRent ? money(rentNum) : "—"}</span>
          </div>
          <FormField
            label="Yeni aylık kira (₺)"
            required
            htmlFor={`increase-rent-${rentalId}`}
            hint={`TÜFE tavanlı öneri: ${money(suggestedRent)} — daha düşük girilebilir, tavan aşılamaz.`}
          >
            <Input
              id={`increase-rent-${rentalId}`}
              type="number"
              min={currentRent + 1}
              max={suggestedRent}
              step="1"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Uygulama tarihi" required htmlFor={`increase-date-${rentalId}`} hint="Yenileme (yıldönümü) tarihi önerilir.">
            <Input
              id={`increase-date-${rentalId}`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </FormField>
          {overCap ? (
            <p className="rounded-[10px] border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700" role="alert">
              Girilen tutar yasal tavanı aşıyor — TÜFE %{appliedRate.toFixed(2)} ile en fazla {money(suggestedRent)} uygulanabilir.
            </p>
          ) : null}
          {!validRent && rent !== "" ? (
            <p className="text-xs font-medium text-danger-600" role="alert">
              Yeni kira mevcut kiradan yüksek olmalı.
            </p>
          ) : null}
          {error ? (
            <p className="text-sm font-medium text-danger-600" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Vazgeç</Button>
          </DialogClose>
          <ConfirmDialog
            tone="default"
            title="Kira artışı uygulansın mı?"
            description={
              validRent
                ? `${money(currentRent)} → ${money(rentNum)} — bundan sonraki tahakkuklar yeni tutardan oluşturulur; mevcut bekleyen tahakkuklar değişmez.`
                : undefined
            }
            confirmLabel="Evet, uygula"
            onConfirm={confirm}
            trigger={
              <Button disabled={!canApply} loading={pending}>
                Artışı uygula
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
