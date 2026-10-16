"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, Users } from "lucide-react";
import { saveRentalGuarantor } from "@/app/actions/rental-applications";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { formatPhoneDisplay } from "@/lib/phone";

type Guarantor = { guarantor_name: string | null; guarantor_phone: string | null; guarantor_address: string | null } | null;

/** Kira kaydının kefili (SP5): sözleşme taslağında {kefil}. Onaylı başvurudan açılan kirada otomatik dolar. */
export function GuarantorCard({ rentalId, guarantor, canEdit }: { rentalId: string; guarantor: Guarantor; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(guarantor?.guarantor_phone ?? "");
  const [pending, start] = useTransition();

  const submit = (fd: FormData) =>
    start(async () => {
      const res = await saveRentalGuarantor(rentalId, fd);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push("Kefil kaydedildi", "ok");
      setEditing(false);
      router.refresh();
    });

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
          <Users className="h-4 w-4 text-brand-600" aria-hidden="true" /> Kefil
        </h3>
        {canEdit && !editing ? (
          <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
            {guarantor?.guarantor_name ? "Düzenle" : "Kefil ekle"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form action={submit} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Ad soyad" htmlFor="g-name" hint="Boş bırakırsanız kefil kaldırılır.">
              <FormInput name="guarantor_name" defaultValue={guarantor?.guarantor_name ?? ""} maxLength={160} />
            </FormField>
            <FormField label="Telefon" htmlFor="g-phone">
              <PhoneInput name="guarantor_phone" value={phone} onValueChange={setPhone} />
            </FormField>
          </div>
          <FormField label="Adres" htmlFor="g-address">
            <FormTextarea name="guarantor_address" rows={2} maxLength={500} defaultValue={guarantor?.guarantor_address ?? ""} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" icon={Save} loading={pending}>Kaydet</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Vazgeç</Button>
          </div>
        </form>
      ) : guarantor?.guarantor_name ? (
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-text-muted">Ad soyad</dt><dd className="font-semibold text-ink-950">{guarantor.guarantor_name}</dd></div>
          {guarantor.guarantor_phone ? (
            <div className="flex justify-between gap-3"><dt className="text-text-muted">Telefon</dt><dd><a href={`tel:${guarantor.guarantor_phone}`} className="font-semibold text-ink-950 underline underline-offset-2">{formatPhoneDisplay(guarantor.guarantor_phone)}</a></dd></div>
          ) : null}
          {guarantor.guarantor_address ? (
            <div className="flex justify-between gap-3"><dt className="text-text-muted">Adres</dt><dd className="text-right text-ink-950">{guarantor.guarantor_address}</dd></div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-text-muted">Kefil kaydı yok. Sözleşmede kefil alanı boş kalır.</p>
      )}
    </section>
  );
}
