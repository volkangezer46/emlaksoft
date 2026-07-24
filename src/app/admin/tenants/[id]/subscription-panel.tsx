"use client";

import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, X } from "lucide-react";
import { updateTenantPlanStatus, type PlatformResult } from "@/app/actions/platform";

type PlanOption = { id: string; name: string; monthlyTry: number };

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "trial", label: "Deneme" },
  { value: "active", label: "Aktif" },
  { value: "past_due", label: "Ödeme gecikti" },
  { value: "suspended", label: "Askıya alındı" },
  { value: "cancelled", label: "İptal edildi" },
];

const initial: PlatformResult = {};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺/ay";
}

export function SubscriptionPanel({
  tenantId,
  currentPlan,
  currentStatus,
  plans,
}: {
  tenantId: string;
  currentPlan: string;
  currentStatus: string;
  plans: PlanOption[];
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(currentPlan);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState(async (_prev: PlatformResult, fd: FormData) => {
    const result = await updateTenantPlanStatus(fd);
    if (result.ok) {
      startTransition(() => {
        setOpen(false);
        router.refresh();
      });
    }
    return result;
  }, initial);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const selectedPlan = plans.find((p) => p.id === plan);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-[10px] border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
      >
        <CreditCard className="h-4 w-4" /> Abonelik değiştir
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/50 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md rounded-[20px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="font-display text-lg font-bold text-ink-950">Aboneliği değiştir</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted hover:bg-canvas"
                aria-label="Kapat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form ref={formRef} action={action} className="grid gap-4 p-6">
              <input type="hidden" name="id" value={tenantId} />

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="sub-plan">
                  Paket
                </label>
                <select
                  id="sub-plan"
                  name="plan"
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {money(p.monthlyTry)}
                    </option>
                  ))}
                </select>
                {selectedPlan ? (
                  <p className="mt-1.5 text-xs text-text-muted">
                    Yeni tutar: <span className="font-semibold text-ink-950">{money(selectedPlan.monthlyTry)}</span> olarak güncellenecek.
                  </p>
                ) : null}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="sub-status">
                  Durum
                </label>
                <select
                  id="sub-status"
                  name="status"
                  defaultValue={currentStatus}
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {state.error ? (
                <p className="text-sm text-danger-500" role="alert">
                  {state.error}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium text-ink-950 hover:bg-canvas"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {pending ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
