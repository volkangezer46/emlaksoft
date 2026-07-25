"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Handshake, Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createPipelineDeal } from "@/app/actions/deals";
import { useToast } from "@/components/app/toast-provider";
import { Combobox } from "@/components/ui/combobox";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";

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
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950"
        >
          <Plus className="h-4 w-4" /> Yeni anlaşma
        </button>
      </DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader
          icon={<Handshake />}
          title="Pipeline’a anlaşma ekle"
          description="Portföy ve müşteriyi eşleştirip aşamayı belirleyin."
        />
        <form onSubmit={onSubmit} className="space-y-3 p-6">
            {/* Uzun listeler Combobox'a alındı. Portföy satırında kod alt
                satırda gösteriliyor (`hint`) — hem aranıyor hem de aynı
                başlıklı iki portföy ayırt edilebiliyor. */}
            <div className="block text-xs font-medium text-text-muted">
              Portföy
              <Combobox
                className="mt-1.5"
                name="property_id"
                aria-label="Portföy"
                placeholder="Seçilmedi"
                searchPlaceholder="Kod ya da başlık ara…"
                emptyText="Eşleşen portföy yok"
                onSearch={searchProperties}
                options={properties.map((p) => ({
                  value: p.id,
                  label: p.title ?? "Başlıksız",
                  hint: p.property_code,
                }))}
              />
            </div>
            <div className="block text-xs font-medium text-text-muted">
              Müşteri
              <Combobox
                className="mt-1.5"
                name="customer_id"
                aria-label="Müşteri"
                placeholder="Seçilmedi"
                searchPlaceholder="Müşteri ara…"
                emptyText="Eşleşen müşteri yok"
                onSearch={searchCustomers}
                options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
              />
            </div>
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
            <div className="hairline-t flex justify-end gap-2 pt-4">
              <DialogClose asChild>
                <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas">
                  Vazgeç
                </button>
              </DialogClose>
              <button type="submit" disabled={pending} className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Kaydet
              </button>
            </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
