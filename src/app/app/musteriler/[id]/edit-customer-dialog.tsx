"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { updateCustomer, type CustomerResult } from "@/app/actions/customers";
import { PhoneInput } from "@/components/ui/phone-input";

type Province = { id: string; name: string };

const initial: CustomerResult = {};
const types = ["Alıcı", "Mülk sahibi", "Kiracı", "Yatırımcı"];

export function EditCustomerDialog({
  customer,
  provinces,
}: {
  customer: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    customer_types: string[] | null;
    province_id: string | null;
    notes: string | null;
    birth_date: string | null;
    anniversary_date: string | null;
    anniversary_note: string | null;
  };
  provinces: Province[];
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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        <Pencil className="h-4 w-4" /> Düzenle
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/45 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-lg rounded-[20px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="font-display text-lg font-bold text-ink-950">Müşteri düzenle</h2>
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted hover:bg-canvas" aria-label="Kapat">
                <X className="h-5 w-5" />
              </button>
            </div>
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
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="edit-province">İl</label>
                <select id="edit-province" name="province_id" defaultValue={customer.province_id ?? ""} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                  <option value="">Seçiniz</option>
                  {provinces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
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
              {state.error ? <p className="sm:col-span-2 text-sm text-danger-500">{state.error}</p> : null}
              <div className="sm:col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium">Vazgeç</button>
                <button type="submit" disabled={pending} className="rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
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
