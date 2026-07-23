"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteCustomer } from "@/app/actions/customers";

export function DeleteCustomerButton({ customerId }: { customerId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-2 rounded-[10px] border border-danger-500/30 bg-danger-500/10 px-3 py-1.5">
        <span className="text-xs font-semibold text-danger-100">Silinsin mi?</span>
        <form action={deleteCustomer}>
          <input type="hidden" name="id" value={customerId} />
          <input type="hidden" name="redirect_to" value="/app/musteriler" />
          <button type="submit" className="rounded-[8px] bg-danger-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-danger-600">
            Evet, sil
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-[8px] px-2 py-1 text-[11px] font-semibold text-white/70 hover:text-white"
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
      className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white/80 transition hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-300"
    >
      <Trash2 className="h-4 w-4" /> Sil
    </button>
  );
}
