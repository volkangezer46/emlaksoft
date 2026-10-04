"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { applyRentIncrease } from "@/app/actions/rentals";
import { useToast } from "@/components/app/toast-provider";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";

/**
 * Yenileme radarındaki "Artışı uygula" akışı — popup yok, sayfa içi panel.
 *
 * Önerilen yeni kira TÜFE tavanından gelir (düzenlenebilir); tavan aşımında
 * uygulama engellenir. Action tarafı (applyRentIncrease) tavanı sunucuda da doğrular.
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (fd: FormData) => {
    setError(null);
    const rentNum = Number(String(fd.get("new_rent") ?? "").replace(",", "."));
    const date = String(fd.get("effective_date") ?? "").trim();
    if (!Number.isFinite(rentNum) || rentNum <= currentRent) {
      setError("Yeni kira mevcut kiradan yüksek olmalı.");
      return;
    }
    if (rentNum > suggestedRent) {
      setError(`Girilen tutar yasal tavanı aşıyor — TÜFE %${appliedRate.toFixed(2)} ile en fazla ${money(suggestedRent)} uygulanabilir.`);
      return;
    }
    if (!date) {
      setError("Uygulama tarihi seçin.");
      return;
    }
    startTransition(async () => {
      const res = await applyRentIncrease(rentalId, rentNum, date);
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Kira artışı uygulandı", "ok");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Kira artışını uygula"
      description={`${propertyName} — TÜFE tavanına göre önerilen oran %${appliedRate.toFixed(2)}. Mevcut kira ${money(currentRent)}; bundan sonraki tahakkuklar yeni tutardan oluşur, bekleyenler değişmez.`}
      icon={<TrendingUp />}
      onSubmit={submit}
      pending={pending}
      error={error}
      submitLabel="Artışı uygula"
      pendingLabel="Uygulanıyor…"
      fieldLabels={{ new_rent: "Yeni aylık kira (₺)", effective_date: "Uygulama tarihi" }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
        >
          <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Artışı uygula
        </button>
      )}
      tabs={[{ id: "artis", label: "Artış", icon: TrendingUp, fields: ["new_rent", "effective_date"] }]}
      panels={{
        artis: (
          <>
            <label className="text-xs font-semibold text-text-muted">
              Yeni aylık kira (₺)
              <input
                name="new_rent"
                type="number"
                min={currentRent + 1}
                max={suggestedRent}
                step="1"
                required
                defaultValue={suggestedRent}
                className={`mt-1 ${fieldClass}`}
              />
              <span className="mt-1 block font-normal text-text-faint">
                TÜFE tavanlı öneri: {money(suggestedRent)} — daha düşük girilebilir, tavan aşılamaz.
              </span>
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Uygulama tarihi
              <input name="effective_date" type="date" required defaultValue={renewalDate} className={`mt-1 ${fieldClass}`} />
              <span className="mt-1 block font-normal text-text-faint">Yenileme (yıldönümü) tarihi önerilir.</span>
            </label>
          </>
        ),
      }}
    />
  );
}
