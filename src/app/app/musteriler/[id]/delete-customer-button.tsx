"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteCustomerWithResult, getCustomerDeleteImpact, type CustomerDeleteImpact } from "@/app/actions/customers";
import { useToast } from "@/components/app/toast-provider";
import { useUndoDelete } from "@/components/app/record-ops-buttons";
import { describeDeleteImpact } from "../delete-impact";

export function DeleteCustomerButton({ customerId }: { customerId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<CustomerDeleteImpact | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { push } = useToast();
  const undo = useUndoDelete();

  async function remove(fd: FormData) {
    const res = await deleteCustomerWithResult(fd);
    if (res.error) {
      push(res.error, "err");
      setConfirming(false);
      return;
    }
    undo("customer", customerId, "Müşteri çöp kutusuna taşındı");
    router.push("/app/musteriler");
  }

  function begin() {
    startTransition(async () => {
      setImpact(await getCustomerDeleteImpact([customerId]));
      setConfirming(true);
    });
  }

  if (confirming) {
    const lines = describeDeleteImpact(impact);
    return (
      <div className="flex max-w-sm flex-col gap-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/10 px-3 py-2">
        <span className="text-xs font-semibold text-danger-100">Silinsin mi?</span>
        {lines.length > 0 ? (
          <p className="text-xs text-danger-100/90">
            Bu müşteriye bağlı: {lines.join(", ")}. Kayıtlar silinmez ama müşterisiz kalır; müşteriyi çöp kutusundan geri alabilirsiniz.
          </p>
        ) : (
          <p className="text-xs text-danger-100/90">Bağlı açık kayıt yok. Çöp kutusundan geri alınabilir.</p>
        )}
        <div className="flex items-center gap-2">
          <form action={remove}>
            <input type="hidden" name="id" value={customerId} />
            <input type="hidden" name="confirm_linked" value="1" />
            <button type="submit" className="rounded-[var(--radius-control)] bg-danger-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-danger-600">
              Evet, sil
            </button>
          </form>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-[var(--radius-control)] px-2 py-1 text-xs font-semibold text-white/70 hover:text-white"
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
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white/80 transition hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-300 disabled:opacity-60"
    >
      <Trash2 className="h-4 w-4" /> {pending ? "Kontrol ediliyor…" : "Sil"}
    </button>
  );
}
