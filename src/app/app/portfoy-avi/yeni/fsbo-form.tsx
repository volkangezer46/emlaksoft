"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { createFsboLead, type ProspectingResult } from "@/app/actions/prospecting";
import { GeoSelect } from "@/components/app/geo-select";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { PersonSelect, type PersonOption } from "@/components/ui/person-select";
import { PhoneInput } from "@/components/ui/phone-input";

type Province = { id: string; name: string };

/** Elle ekleme: ilan bağlantısını yapıştır + telefon. Sunucu portal sayfasını ÇEKMEZ; alanları danışman girer. */
export function FsboForm({ provinces, people, isManager }: { provinces: Province[]; people: readonly PersonOption[]; isManager: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [state, action, pending] = useActionState<ProspectingResult, FormData>(createFsboLead, {});

  useEffect(() => {
    if (!state.ok || !state.id) return;
    push("Sahibinden ilan kaydedildi.", "ok");
    (state.notices ?? []).forEach((n) => push(n, "info"));
    router.push(`/app/portfoy-avi/${state.id}`);
  }, [state, push, router]);

  return (
    <form action={action}>
      <FormPage
        title="Sahibinden ilan ekle"
        description="Açtığınız ilanın bağlantısını yapıştırın; telefonu yalnız ilanda gördüyseniz ekleyin. Sunucu portal sayfasını kendiliğinden açmaz."
        eyebrow="Sahibinden ilanlar"
        breadcrumbs={[{ label: "Sahibinden ilanlar", href: "/app/portfoy-avi" }, { label: "Yeni" }]}
      >
        <FormSection title="İlan" description="Sahibinden, Hepsiemlak veya Emlakjet ilan bağlantısı.">
          <FormField label="İlan bağlantısı" htmlFor="fsbo-url" className="sm:col-span-2" hint="Ör. https://www.sahibinden.com/ilan/…-1234567890/detay">
            <FormInput id="fsbo-url" name="url" inputMode="url" autoComplete="off" maxLength={600} placeholder="https://" />
          </FormField>
          <FormField label="Başlık" htmlFor="fsbo-title" className="sm:col-span-2">
            <FormInput id="fsbo-title" name="title" maxLength={200} placeholder="Örn. Kadıköy Moda 3+1 satılık daire" />
          </FormField>
          <FormField label="İşlem" htmlFor="fsbo-tx">
            <FormSelect id="fsbo-tx" name="transaction_type" defaultValue="sale">
              <option value="sale">Satılık</option>
              <option value="rent">Kiralık</option>
            </FormSelect>
          </FormField>
          <FormField label="Fiyat (TL)" htmlFor="fsbo-price">
            <FormInput id="fsbo-price" name="price" inputMode="decimal" placeholder="4.200.000" />
          </FormField>
          <FormField label="Oda" htmlFor="fsbo-rooms">
            <FormInput id="fsbo-rooms" name="rooms" maxLength={20} placeholder="3+1" />
          </FormField>
          <FormField label="Brüt m²" htmlFor="fsbo-m2">
            <FormInput id="fsbo-m2" name="gross_m2" inputMode="decimal" placeholder="120" />
          </FormField>
          <GeoSelect provinces={provinces} withNeighborhood={false} className="sm:col-span-2" />
          <FormField label="Konum notu" htmlFor="fsbo-loc" className="sm:col-span-2">
            <FormInput id="fsbo-loc" name="location_text" maxLength={200} placeholder="Mahalle / semt" />
          </FormField>
        </FormSection>

        <FormSection title="İlan sahibi" description="Yalnız ilanda görünen bilgiler. TC kimlik no veya vergi no istenmez.">
          <FormField label="Ad (ilanda görünen)" htmlFor="fsbo-owner">
            <FormInput id="fsbo-owner" name="owner_name" maxLength={120} autoComplete="off" />
          </FormField>
          <FormField label="Telefon" htmlFor="fsbo-phone" hint="Ofiste aranmasın listesinde olan numara kilitli kaydedilir.">
            <PhoneInput id="fsbo-phone" name="phone" />
          </FormField>
          {isManager ? (
            <FormField label="Danışman" htmlFor="fsbo-assignee" inject={false} className="sm:col-span-2">
              <PersonSelect id="fsbo-assignee" name="assigned_to" people={people} emptyLabel="Bana ata" clearable />
            </FormField>
          ) : null}
        </FormSection>

        <FormError error={state.error} />
        <FormActions>
          <ButtonLink href="/app/portfoy-avi" variant="ghost">Vazgeç</ButtonLink>
          <Button type="submit" icon={Check} loading={pending}>Kaydet</Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
