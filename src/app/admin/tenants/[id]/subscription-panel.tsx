"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { updateTenantPlanStatus, type PlatformResult } from "@/app/actions/platform";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

type PlanOption = { id: string; name: string; monthlyTry: number };

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "trial", label: "Deneme" },
  { value: "active", label: "Aktif" },
  { value: "past_due", label: "Ödeme gecikti" },
  { value: "suspended", label: "Askıya alındı" },
  { value: "cancelled", label: "İptal edildi" },
];

const initial: PlatformResult = {};

function money(amount: number) {
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(amount)} ₺/ay`;
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

  const [state, action, pending] = useActionState(async (_prev: PlatformResult, formData: FormData) => {
    const result = await updateTenantPlanStatus(formData);
    if (result.ok) {
      startTransition(() => {
        setOpen(false);
        router.refresh();
      });
    }
    return result;
  }, initial);

  const selectedPlan = plans.find((option) => option.id === plan);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
        >
          <CreditCard className="h-4 w-4" /> Abonelik değiştir
        </button>
      </DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader
          title="Aboneliği değiştir"
          description="Paket ve abonelik durumunu kontrollü olarak güncelleyin."
          icon={<CreditCard />}
        />
        <form ref={formRef} action={action}>
          <DialogBody className="grid gap-4">
            <input type="hidden" name="id" value={tenantId} />

            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="sub-plan">
                Paket
              </label>
              <select
                id="sub-plan"
                name="plan"
                value={plan}
                onChange={(event) => setPlan(event.target.value)}
                className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              >
                {plans.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} — {money(option.monthlyTry)}
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
                className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>

            {state.error ? (
              <p className="text-sm text-danger-500" role="alert">
                {state.error}
              </p>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-[var(--radius-control)] border border-line px-4 py-2.5 text-sm font-medium text-ink-950 hover:bg-canvas"
              >
                Vazgeç
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
