"use client";

import { Button } from "@/components/ui/button";
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
        <Button variant="outline" size="md" type="button">
          <CreditCard className="h-4 w-4" /> Abonelik değiştir
        </Button>
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
              <Button variant="outline" size="md" type="button">
                Vazgeç
              </Button>
            </DialogClose>
            <Button variant="primary" size="md" type="submit" disabled={pending}>
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
