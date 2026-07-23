"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteCustomer } from "@/app/actions/customers";

export function CustomerRowDelete({ customerId, name }: { customerId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <form action={deleteCustomer}>
          <input type="hidden" name="id" value={customerId} />
          <button
            type="submit"
            className="rounded-[7px] bg-danger-500 px-2 py-1 text-[10px] font-bold text-white hover:bg-danger-600"
          >
            Sil
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-[7px] px-1.5 py-1 text-[10px] font-semibold text-text-muted hover:text-ink-950"
        >
          Vazgeç
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-500"
      aria-label={`${name} müşterisini sil`}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
