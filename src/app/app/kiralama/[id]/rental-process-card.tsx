"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleDashed, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setRentalProcessStep } from "@/app/actions/rentals";
import { useToast } from "@/components/app/toast-provider";
import type { RentalProcessStep } from "@/lib/rental-process";

function dayLabel(iso: string | null) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/**
 * Kiralık işlem süreci (SP4): başvurudan anahtar teslimine adım takibi. Kayıtlardan tamamlanan adımlar (imzalı sözleşme,
 * depozito + ilk kira) kendiliğinden işaretlenir; diğerleri tek dokunuşla (≥44 px) işaretlenir/geri alınır.
 * Hepsi tamamsa kart kapalı özet olarak durur.
 */
export function RentalProcessCard({
  rentalId,
  steps,
  done,
  total,
  canEdit,
}: {
  rentalId: string;
  steps: RentalProcessStep[];
  done: number;
  total: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const complete = done >= total;

  function toggle(step: RentalProcessStep) {
    setPendingKey(step.key);
    startTransition(async () => {
      const res = await setRentalProcessStep(rentalId, step.key, step.state !== "done");
      setPendingKey(null);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      router.refresh();
    });
  }

  const list = (
    <ol className="mt-3 space-y-1.5">
      {steps.map((s) => {
        const isDone = s.state === "done";
        const busy = pendingKey === s.key;
        return (
          <li key={s.key} className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-2">
            <span
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                isDone ? "bg-mint-500 text-white" : s.state === "in_progress" ? "bg-amber-400/25 text-amber-700" : "bg-surface-sunken text-text-faint"
              }`}
              aria-hidden
            >
              {isDone ? <Check className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${isDone ? "text-ink-950" : "text-ink-800"}`}>{s.label}</p>
              <p className="text-xs text-text-muted">
                {isDone
                  ? s.source === "auto"
                    ? "Kayıtlardan tamamlandı"
                    : `İşaretlendi${dayLabel(s.doneDay) ? ` · ${dayLabel(s.doneDay)}` : ""}`
                  : s.state === "in_progress"
                    ? `Sürüyor — ${s.hint}`
                    : s.hint}
              </p>
            </div>
            {canEdit && s.canToggle ? (
              <Button
                type="button"
                size="sm"
                variant={isDone ? "ghost" : "secondary"}
                onClick={() => toggle(s)}
                loading={busy}
                aria-pressed={isDone}
                aria-label={isDone ? `${s.label}: işareti kaldır` : `${s.label}: tamamlandı olarak işaretle`}
                className="shrink-0"
              >
                {isDone ? "Geri al" : "Tamamlandı"}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );

  const header = (
    <span className="flex w-full flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <KeyRound className="h-4 w-4 text-brand-600" aria-hidden /> Kiralık süreç
      </span>
      <span className="flex items-center gap-2 text-xs font-semibold text-text-muted">
        <span
          className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label="Süreç ilerlemesi"
        >
          <span className="block h-full rounded-full bg-mint-500" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </span>
        {done}/{total}
      </span>
    </span>
  );

  return (
    <section id="kira-sureci" className="scroll-mt-20 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      {complete ? (
        <details>
          <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center rounded-[var(--radius-control)]">{header}</summary>
          {list}
        </details>
      ) : (
        <>
          {header}
          {list}
        </>
      )}
    </section>
  );
}
