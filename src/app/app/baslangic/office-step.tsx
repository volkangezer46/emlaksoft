"use client";

import { FileInput } from "@/components/ui/file-input";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { GeoSelect } from "@/components/app/geo-select";
import type { GeoOption } from "@/lib/geo/types";
import { saveOfficeProfile } from "@/app/actions/onboarding-setup";
import { uploadTenantLogo } from "@/app/actions/tenant-logo";

type Props = {
  canEdit: boolean;
  nextHref: string;
  initial: { name: string; phone: string; city: string; provinceId: string | null; districtId: string | null; addressLine: string; licenseNo: string; taxNumber: string; logoUrl: string | null };
  provinces: GeoOption[];
};

const inputCls =
  "focus-ring w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-text";

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-text-faint">{hint}</p> : null}
    </div>
  );
}

/** Adım 1: ofis bilgileri. Yalnız mevcut tenants alanları; logo varsa mevcut yükleme action'ı. */
export function OfficeStep({ canEdit, nextHref, initial, provinces }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return <Alert tone="info">Ofis bilgilerini yalnız ayar yetkisi olan kullanıcılar düzenleyebilir. Bu adımı atlayabilirsiniz.</Alert>;
  }

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveOfficeProfile(formData);
      if (result.error) return setError(result.error);
      const file = fileRef.current?.files?.[0];
      if (file && file.size > 0) {
        const logoData = new FormData();
        logoData.set("logo", file);
        const logo = await uploadTenantLogo(logoData);
        if (logo.error) return setError(`Bilgiler kaydedildi ama logo yüklenemedi: ${logo.error}`);
      }
      router.push(nextHref);
    });
  }

  return (
    <form action={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
      <div className="sm:col-span-2">
        <Field label="Ofis adı" htmlFor="kur-name">
          <input id="kur-name" name="name" required defaultValue={initial.name} className={inputCls} autoComplete="organization" />
        </Field>
      </div>
      <Field label="Telefon" htmlFor="kur-phone">
        <PhoneInput id="kur-phone" name="phone" defaultValue={initial.phone} className={inputCls} />
      </Field>
      <Field label="Ruhsat no" htmlFor="kur-license">
        <input id="kur-license" name="license_no" defaultValue={initial.licenseNo} className={inputCls} />
      </Field>
      <div className="sm:col-span-2">
        <GeoSelect provinces={provinces} defaultProvinceId={initial.provinceId} defaultDistrictId={initial.districtId} withNeighborhood={false} />
      </div>
      <Field label="Vergi no / T.C. kimlik no" htmlFor="kur-tax" hint="Ödeme ve fatura için gerekir; 10 haneli vergi no ya da 11 haneli T.C. kimlik no.">
        <input id="kur-tax" name="tax_number" inputMode="numeric" maxLength={11} defaultValue={initial.taxNumber} className={inputCls} placeholder="1234567890" />
      </Field>
      <Field label="Açık adres" htmlFor="kur-address" hint="Fatura için en az 10 karakter.">
        <input id="kur-address" name="address_line" defaultValue={initial.addressLine} placeholder="Kadıköy, Bağdat Cad. No:42" className={inputCls} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Logo (isteğe bağlı)" htmlFor="kur-logo" hint="PNG, JPG veya WebP. Sözleşme, brifing ve portal çıktılarında görünür.">
          <div className="flex items-center gap-3">
            {initial.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant logosu dış depodan gelir
              <img src={initial.logoUrl} alt="Mevcut logo" className="h-10 w-10 rounded-[var(--radius-control)] border border-line object-contain" />
            ) : null}
            <FileInput id="kur-logo" ref={fileRef} accept="image/png,image/jpeg,image/webp" />
          </div>
        </Field>
      </div>
      {error ? (
        <div className="sm:col-span-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending}>
          Kaydet ve devam et
        </Button>
      </div>
    </form>
  );
}
