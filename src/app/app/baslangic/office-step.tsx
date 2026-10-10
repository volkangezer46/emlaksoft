"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import { GeoSelect } from "@/components/app/geo-select";
import { saveOfficeProfile } from "@/app/actions/onboarding-setup";
import { uploadTenantLogo } from "@/app/actions/tenant-logo";
import type { GeoOption } from "@/lib/geo/types";

const inputCls =
  "focus-ring min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-base text-text sm:text-sm";

/**
 * Adım "Ofis bilgilerin": ofis adı (kayıtta "<Ad Soyad> Emlak" olarak kuruldu), şehir ve ilçe, açık adres, logo (isteğe
 * bağlı). Kayıt `saveOfficeProfile` (il/ilçe TEK MERKEZ geo doğrulaması) ve `uploadTenantLogo` ile; telefon, yetki belgesi,
 * vergi ve marka ayrıntıları isteğe bağlıdır (Ayarlar > Marka ve kimlik).
 */
export function OfficeStep({
  canEdit,
  nextHref,
  officeName,
  provinces,
  provinceId,
  districtId,
  addressLine,
  logoUrl,
}: {
  canEdit: boolean;
  nextHref: string;
  officeName: string;
  provinces: GeoOption[];
  provinceId: string | null;
  districtId: string | null;
  addressLine: string | null;
  logoUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return <Alert tone="info">Ofis bilgilerini yalnız ayar yetkisi olan kullanıcılar düzenleyebilir. Bu adımı atlayabilirsin.</Alert>;
  }

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await saveOfficeProfile(fd);
      if (res.error) return setError(res.error);
      const file = fileRef.current?.files?.[0];
      if (file && file.size > 0) {
        const logoFd = new FormData();
        logoFd.set("logo", file);
        const logo = await uploadTenantLogo(logoFd);
        if (logo.error) return setError(logo.error);
      }
      router.push(nextHref);
      router.refresh();
    });
  }

  return (
    <form action={submit} className="grid grid-cols-1 gap-4 [&>*]:min-w-0">
      <div>
        <label htmlFor="ofis-adi" className="mb-1 block text-xs font-semibold text-text-muted">
          Ofis adı
        </label>
        <input id="ofis-adi" name="name" required maxLength={120} defaultValue={officeName} autoComplete="organization" className={inputCls} />
        <p className="mt-1 text-xs text-text-faint">Sözleşme, vitrin ve belgelerde bu ad görünür; istediğin an değiştirebilirsin.</p>
      </div>
      <GeoSelect provinces={provinces} defaultProvinceId={provinceId} defaultDistrictId={districtId} withNeighborhood={false} required />
      <div>
        <label htmlFor="ofis-adres" className="mb-1 block text-xs font-semibold text-text-muted">
          Açık adres
        </label>
        <input id="ofis-adres" name="address_line" defaultValue={addressLine ?? ""} autoComplete="street-address" placeholder="Kadıköy, Bağdat Cad. No:42" className={inputCls} />
        <p className="mt-1 text-xs text-text-faint">Fatura ve vitrin için en az 10 karakter: mahalle, cadde/sokak, bina no.</p>
      </div>
      <div>
        <label htmlFor="ofis-logo" className="mb-1 block text-xs font-semibold text-text-muted">
          Logo (isteğe bağlı)
        </label>
        <div className="flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- tenant logosu dış depodan gelir
            <img src={logoUrl} alt="Mevcut logo" className="h-12 w-12 rounded-[var(--radius-control)] border border-line object-contain" />
          ) : null}
          <FileInput id="ofis-logo" ref={fileRef} accept="image/png,image/jpeg,image/webp" />
        </div>
        <p className="mt-1 text-xs text-text-faint">PNG, JPG veya WebP · en çok 2 MB.</p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <Button type="submit" loading={pending}>
          Kaydet ve devam et
        </Button>
      </div>
    </form>
  );
}
