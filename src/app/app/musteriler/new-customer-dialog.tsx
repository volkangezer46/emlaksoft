"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GeoSelect } from "@/components/app/geo-select";
import { createCustomer, type CustomerResult } from "@/app/actions/customers";
import { PhoneInput } from "@/components/ui/phone-input";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

const initial: CustomerResult = {};

const DEFAULT_TYPES = ["Alıcı", "Mülk sahibi", "Kiracı", "Yatırımcı"];

export function NewCustomerDialog({
  provinces,
  branches = [],
  types = DEFAULT_TYPES,
}: {
  provinces: Province[];
  branches?: Branch[];
  types?: string[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  // Başarı sonrası kapat + formu sıfırla + listeyi yenile: efekt gövdesinde
  // senkron setState yerine action akışında. Ayrıca eski efektin bağımlılığı
  // `[state, router]` olduğu için aynı sonuç nesnesi tekrar gelse de
  // tetiklenebiliyordu; burada yalnızca gerçek bir başarıda çalışır.
  const [state, action, pending] = useActionState(
    async (prev: typeof initial, formData: FormData) => {
      const result = await createCustomer(prev, formData);
      if (result.ok) {
        setOpen(false);
        formRef.current?.reset();
        router.refresh();
      }
      return result;
    },
    initial,
  );

  /*
   * Radix Dialog'a taşındı. Elle kurulum Esc'i hallediyordu ama FOCUS TRAP ve
   * SCROLL LOCK yoktu. Ayrıca tetikleyici ve kapat butonlarında `type="button"`
   * eksikti — form içinde kullanılsalar submit tetikleyeceklerdi.
   */
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          Yeni müşteri
        </button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<Plus />}
          title="Yeni müşteri"
          description="Temel bilgilerle müşteri kaydı açın."
        />
        <form ref={formRef} action={action} className="grid gap-4 p-4 sm:grid-cols-2 md:p-6">
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
              {/* Musteride mahalle gereksiz; ilce yeterli ve bolge bazli
                  raporlama/filtreleme icin kritik. */}
              <div className="sm:col-span-2">
                <GeoSelect provinces={provinces} withNeighborhood={false} />
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
                <p className="sm:col-span-2 text-sm font-medium text-danger-600" role="alert">
                  {state.error}
                </p>
              ) : null}

          <div className="hairline-t sm:col-span-2 flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <button
                type="button"
                className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas"
              >
                Vazgeç
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={pending}
              className="btn-shine focus-ring press rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
