"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { createCustomer, type CustomerResult } from "@/app/actions/customers";
import { GeoSelect } from "@/components/app/geo-select";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import { PhoneInput } from "@/components/ui/phone-input";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

const initial: CustomerResult = {};

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";
const labelClass = "mb-1.5 block text-sm text-text-muted";

export function CustomerForm({
  provinces,
  branches,
  types,
}: {
  provinces: Province[];
  branches: Branch[];
  types: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: CustomerResult, formData: FormData) => {
    const result = await createCustomer(prev, formData);
    if (result.ok) {
      toast.push("Müşteri kaydedildi");
      router.push(result.id ? `/app/musteriler/${result.id}` : "/app/musteriler");
    }
    return result;
  }, initial);

  return (
    <form action={action}>
      <FormPage
        title="Yeni müşteri"
        description="Temel bilgilerle müşteri kaydı açın."
        breadcrumbs={[{ label: "Müşteriler", href: "/app/musteriler" }, { label: "Yeni müşteri" }]}
      >
        <FormSection title="Kişi bilgileri" description="Ad soyad zorunludur; iletişim bilgileri sonradan eklenebilir.">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="full_name">Ad soyad *</label>
            <input id="full_name" name="full_name" required className={fieldClass} placeholder="Örn. Ali Kaya" />
          </div>
          <div>
            <label className={labelClass} htmlFor="phone">Telefon</label>
            <PhoneInput id="phone" name="phone" />
          </div>
          <div>
            <label className={labelClass} htmlFor="email">E-posta</label>
            <input id="email" name="email" type="email" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="type">Müşteri türü</label>
            <select id="type" name="type" className={fieldClass} defaultValue="Alıcı">
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {branches.length > 0 ? (
            <div>
              <label className={labelClass} htmlFor="branch_id">Şube</label>
              <select id="branch_id" name="branch_id" className={fieldClass} defaultValue="">
                <option value="">Şube atanmadı</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          ) : null}
        </FormSection>

        <FormSection title="Bölge" description="İlçe, bölge bazlı raporlama ve filtreleme için kullanılır.">
          {/* Müşteride mahalle gereksiz; ilçe yeterli. */}
          <div className="sm:col-span-2">
            <GeoSelect provinces={provinces} withNeighborhood={false} />
          </div>
        </FormSection>

        <FormSection title="Özel günler" description="Doğum günü ve yıldönümü hatırlatmaları için.">
          <div>
            <label className={labelClass} htmlFor="birth_date">Doğum tarihi</label>
            <input id="birth_date" name="birth_date" type="date" max="2100-12-31" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="anniversary_date">Yıldönümü</label>
            <input id="anniversary_date" name="anniversary_date" type="date" max="2100-12-31" className={fieldClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="anniversary_note">Yıldönümü notu</label>
            <input id="anniversary_note" name="anniversary_note" className={fieldClass} placeholder="Örn. İlk ev alımı, 3 yıllık kiracı" />
          </div>
        </FormSection>

        <FormSection title="Not">
          <div className="sm:col-span-2">
            <label className="sr-only" htmlFor="notes">Not</label>
            <textarea id="notes" name="notes" rows={3} className={`${fieldClass} resize-none`} placeholder="Talep, bütçe, tercih vb." />
          </div>
        </FormSection>

        {state.error ? (
          <p className="text-sm font-medium text-danger-600" role="alert">{state.error}</p>
        ) : null}

        <FormActions>
          <ButtonLink href="/app/musteriler" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={pending} icon={Save}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
