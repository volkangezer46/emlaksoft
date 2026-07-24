"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { createPipelineDeal } from "@/app/actions/deals";
import { useToast } from "@/components/app/toast-provider";

type Prop = { id: string; property_code: string; title: string | null; list_price: number | null; transaction_type: string };
type Cust = { id: string; full_name: string };

export function NewDealDialog({ properties, customers }: { properties: Prop[]; customers: Cust[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createPipelineDeal(fd);
      if (res.error) push(res.error, "err");
      else {
        push("Anlaşma pipeline’a eklendi", "ok");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-shine inline-flex items-center gap-1.5 rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950"
      >
        <Plus className="h-4 w-4" /> Yeni anlaşma
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <button type="button" aria-label="Kapat" className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <form
            onSubmit={onSubmit}
            className="relative my-auto w-full max-w-md space-y-3 rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-lg)]"
          >
            <h2 className="font-display text-lg font-bold text-ink-950">Pipeline’a anlaşma ekle</h2>
            <label className="block text-xs font-medium text-text-muted">
              Portföy
              <select name="property_id" className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                <option value="">Seçilmedi</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.property_code} · {p.title ?? "Başlıksız"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-text-muted">
              Müşteri
              <select name="customer_id" className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                <option value="">Seçilmedi</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium text-text-muted">
                Tür
                <select name="deal_type" defaultValue="sale" className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                  <option value="sale">Satış</option>
                  <option value="rent">Kiralama</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-text-muted">
                Aşama
                <select name="stage" defaultValue="new" className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                  <option value="new">Yeni</option>
                  <option value="qualified">Nitelikli</option>
                  <option value="negotiation">Müzakere</option>
                </select>
              </label>
            </div>
            <label className="block text-xs font-medium text-text-muted">
              Tutar (₺)
              <input name="deal_value" inputMode="decimal" placeholder="örn. 4.500.000" className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
            </label>
            <label className="flex items-start gap-2 rounded-[10px] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs">
              <input type="checkbox" name="has_authority" value="1" className="mt-0.5 accent-mint-600" />
              <span>
                <span className="font-bold text-mint-700">Yazılı yetki / EİDS onaylı</span>
                <span className="mt-0.5 block text-text-muted">Müzakere veya kazanılan aşaması için gerekli.</span>
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-text-muted">
                Vazgeç
              </button>
              <button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Kaydet
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
