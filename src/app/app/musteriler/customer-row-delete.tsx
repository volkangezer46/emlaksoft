"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteCustomer, getCustomerDeleteImpact, type CustomerDeleteImpact } from "@/app/actions/customers";
import { describeDeleteImpact } from "./delete-impact";

export function CustomerRowDelete({ customerId, name }: { customerId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<CustomerDeleteImpact | null>(null);
  const [pending, startTransition] = useTransition();

  function begin() {
    startTransition(async () => {
      setImpact(await getCustomerDeleteImpact([customerId]));
      setConfirming(true);
    });
  }

  if (confirming) {
    const lines = describeDeleteImpact(impact);
    return (
      <div className="flex flex-col items-end gap-1">
        {lines.length > 0 ? (
          <p className="max-w-[14rem] text-right text-xs text-danger-500">Bağlı: {lines.join(", ")}</p>
        ) : null}
        <div className="flex items-center gap-1">
          <form action={deleteCustomer}>
            <input type="hidden" name="id" value={customerId} />
            <input type="hidden" name="confirm_linked" value="1" />
            <button
              type="submit"
              className="rounded-[var(--radius-control)] bg-danger-500 px-2 py-1 text-xs font-bold text-white hover:bg-danger-600"
            >
              Sil
            </button>
          </form>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-[var(--radius-control)] px-1.5 py-1 text-xs font-semibold text-text-muted hover:text-ink-950"
          >
            Vazgeç
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={begin}
      disabled={pending}
      className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-500 disabled:opacity-60"
      aria-label={`${name} müşterisini sil`}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
