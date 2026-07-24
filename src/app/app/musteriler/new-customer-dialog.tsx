"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Plus, X } from "lucide-react";
import { createCustomer, type CustomerResult } from "@/app/actions/customers";
import { PhoneInput } from "@/components/ui/phone-input";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

const initial: CustomerResult = {};

const types = ["Alıcı", "Mülk sahibi", "Kiracı", "Yatırımcı"];

export function NewCustomerDialog({ provinces, branches = [] }: { provinces: Province[]; branches?: Branch[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createCustomer, initial);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        <Plus className="h-4 w-4" />
        Yeni müşteri
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-lg rounded-[20px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="font-display text-lg font-bold text-ink-950">
                Yeni müşteri
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted hover:bg-canvas"
                aria-label="Kapat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form ref={formRef} action={action} className="grid gap-4 p-6 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="full_name">
                  Ad soyad *
                </label>
                <input
                  id="full_name"
                  name="full_name"
                  required
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                  placeholder="Örn. Ali Kaya"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="phone">
                  Telefon
                </label>
                <PhoneInput id="phone" name="phone" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="email">
                  E-posta
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="type">
                  Müşteri türü
                </label>
                <select
                  id="type"
                  name="type"
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                  defaultValue="Alıcı"
                >
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="province_id">
                  İl
                </label>
                <select
                  id="province_id"
                  name="province_id"
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                  defaultValue=""
                >
                  <option value="">Seçiniz</option>
                  {provinces.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {branches.length > 0 ? (
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm text-text-muted" htmlFor="branch_id">
                    Şube
                  </label>
                  <select
                    id="branch_id"
                    name="branch_id"
                    className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                    defaultValue=""
                  >
                    <option value="">Şube atanmadı</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="birth_date">
                  Doğum tarihi
                </label>
                <input
                  id="birth_date"
                  name="birth_date"
                  type="date"
                  max="2100-12-31"
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="anniversary_date">
                  Yıldönümü
                </label>
                <input
                  id="anniversary_date"
                  name="anniversary_date"
                  type="date"
                  max="2100-12-31"
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="anniversary_note">
                  Yıldönümü notu
                </label>
                <input
                  id="anniversary_note"
                  name="anniversary_note"
                  className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                  placeholder="Örn. İlk ev alımı, 3 yıllık kiracı"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="notes">
                  Not
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  className="w-full resize-none rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
                  placeholder="Talep, bütçe, tercih vb."
                />
              </div>

              {state.error ? (
                <p className="sm:col-span-2 text-sm text-danger-500" role="alert">
                  {state.error}
                </p>
              ) : null}

              <div className="sm:col-span-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium text-ink-950 hover:bg-canvas"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
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
