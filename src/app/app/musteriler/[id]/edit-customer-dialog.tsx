"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GeoSelect } from "@/components/app/geo-select";
import { updateCustomer, type CustomerResult } from "@/app/actions/customers";
import { PhoneInput } from "@/components/ui/phone-input";

type Province = { id: string; name: string };

const initial: CustomerResult = {};
const DEFAULT_TYPES = ["Alıcı", "Mülk sahibi", "Kiracı", "Yatırımcı"];

export function EditCustomerDialog({
  customer,
  provinces,
  types = DEFAULT_TYPES,
}: {
  customer: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    customer_types: string[] | null;
    province_id: string | null;
    district_id: string | null;
    notes: string | null;
    birth_date: string | null;
    anniversary_date: string | null;
    anniversary_note: string | null;
  };
  provinces: Province[];
  types?: string[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const defaultType = customer.customer_types?.[0] ?? "Alıcı";

  const [state, action, pending] = useActionState(async (prev: CustomerResult, formData: FormData) => {
    const result = await updateCustomer(prev, formData);
    if (result.ok) {
      startTransition(() => {
        setOpen(false);
        router.refresh();
      });
    }
    return result;
  }, initial);

  return (
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <Pencil className="h-4 w-4" /> Düzenle
        </button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<Pencil />}
          title="Müşteri düzenle"
          description={customer.full_name}
        />
        <form ref={formRef} action={action} className="grid gap-4 p-6 sm:grid-cols-2">
              <input type="hidden" name="id" value={customer.id} />
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="edit-full-name">Ad soyad *</label>
                <input id="edit-full-name" name="full_name" required defaultValue={customer.full_name} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="edit-phone">Telefon</label>
                <PhoneInput id="edit-phone" name="phone" defaultValue={customer.phone} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="edit-email">E-posta</label>
                <input id="edit-email" name="email" type="email" defaultValue={customer.email ?? ""} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="edit-type">Tür</label>
                <select id="edit-type" name="type" defaultValue={defaultType} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <GeoSelect
                  provinces={provinces}
                  withNeighborhood={false}
                  defaultProvinceId={customer.province_id}
                  defaultDistrictId={customer.district_id}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="edit-birth-date">Doğum tarihi</label>
                <input id="edit-birth-date" name="birth_date" type="date" max="2100-12-31" defaultValue={customer.birth_date ?? ""} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="edit-anniversary-date">Yıldönümü</label>
                <input id="edit-anniversary-date" name="anniversary_date" type="date" max="2100-12-31" defaultValue={customer.anniversary_date ?? ""} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="edit-anniversary-note">Yıldönümü notu</label>
                <input id="edit-anniversary-note" name="anniversary_note" defaultValue={customer.anniversary_note ?? ""} placeholder="Örn. İlk ev alımı, 3 yıllık kiracı" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="edit-notes">Not</label>
                <textarea id="edit-notes" name="notes" rows={3} defaultValue={customer.notes ?? ""} className="w-full resize-none rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" />
              </div>
              {state.error ? (
                <p className="sm:col-span-2 text-sm font-medium text-danger-600" role="alert">{state.error}</p>
              ) : null}
              <div className="hairline-t sm:col-span-2 flex justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
                    Vazgeç
                  </button>
                </DialogClose>
                <button type="submit" disabled={pending} className="btn-shine focus-ring press rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  {pending ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
