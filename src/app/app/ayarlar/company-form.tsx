"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Save } from "lucide-react";
import { updateTenantInfo } from "@/app/actions/settings";
import { PhoneInput } from "@/components/ui/phone-input";
import { GeoSelect } from "@/components/app/geo-select";
import type { GeoOption } from "@/lib/geo/types";

type Tenant = {
  name: string;
  tax_office: string | null;
  tax_number: string | null;
  license_no: string | null;
  brand_color: string | null;
  iban: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  province_id?: string | null;
  district_id?: string | null;
  logo_url?: string | null;
  website?: string | null;
  license_title?: string | null;
  license_valid_until?: string | null;
};

const BADGE_TONE: Record<string, string> = {
  danger: "bg-danger-500/10 text-danger-500",
  warning: "bg-amber-400/15 text-amber-700",
  ok: "bg-mint-500/10 text-mint-700",
  neutral: "bg-canvas text-text-muted",
};

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

export function CompanyForm({
  tenant,
  provinces,
  licenseBadge,
  licenseColumnsReady = true,
}: {
  tenant: Tenant;
  provinces: GeoOption[];
  /** Sunucuda hesaplanan yetki belgesi durum rozeti (tarih okuma sunucuda: React saflık kuralı). */
  licenseBadge?: { label: string; tone: "danger" | "warning" | "ok" | "neutral" };
  /** Belge unvanı/geçerlilik sütunları (migration 20260826001800) etkin mi. */
  licenseColumnsReady?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateTenantInfo(formData);
    setPending(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
      return;
    }
    setError(result.error ?? "Kaydedilemedi.");
  }

  return (
    <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600"><Building2 className="h-5 w-5" /></span>
        <div>
          <h2 className="font-display font-bold text-ink-950">Firma bilgileri</h2>
          <p className="text-xs text-text-muted">Ofis kimliği, vergi ve yetki belgesi bilgileri.</p>
        </div>
      </div>

      <form action={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-name">Ofis adı *</label>
          <input id="tenant-name" name="name" required defaultValue={tenant.name} className={fieldClass} placeholder="EmlakSoft Gayrimenkul" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-phone">Telefon</label>
          <PhoneInput id="tenant-phone" name="phone" defaultValue={tenant.phone} className={fieldClass} />
        </div>
        <div className="sm:col-span-2">
          <GeoSelect provinces={provinces} defaultProvinceId={tenant.province_id} defaultDistrictId={tenant.district_id} withNeighborhood={false} />
          {!tenant.province_id && tenant.city ? <p className="mt-1 text-xs text-text-muted">Kayıtlı şehir metni: {tenant.city}. İl seçerek kimliğe bağlayın.</p> : null}
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-address">Adres</label>
          <input id="tenant-address" name="address_line" defaultValue={tenant.address_line ?? ""} className={fieldClass} placeholder="Bağdat Cad. No:42 Kadıköy" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-tax-office">Vergi dairesi</label>
          <input id="tenant-tax-office" name="tax_office" defaultValue={tenant.tax_office ?? ""} className={fieldClass} placeholder="Onikişubat VD" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-tax-number">Vergi / TC no</label>
          <input id="tenant-tax-number" name="tax_number" defaultValue={tenant.tax_number ?? ""} className={fieldClass} placeholder="1234567890" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-license">Yetki belgesi no</label>
          <input id="tenant-license" name="license_no" defaultValue={tenant.license_no ?? ""} maxLength={60} className={fieldClass} placeholder="TR-46-00123" />
          <p className="mt-1 text-xs text-text-muted">Harf, rakam ve boşluk girebilirsiniz. İlan, vitrin, sunum ve broşürde görünür.</p>
        </div>
        {licenseColumnsReady ? (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-license-title">Belge unvanı</label>
              <input id="tenant-license-title" name="license_title" defaultValue={tenant.license_title ?? ""} maxLength={200} className={fieldClass} placeholder="Belgede yazan işletme unvanı" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-license-valid">Belge geçerlilik tarihi</label>
              <input id="tenant-license-valid" name="license_valid_until" type="date" defaultValue={tenant.license_valid_until ?? ""} className={fieldClass} />
              {licenseBadge ? (
                <span className={`mt-1.5 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${BADGE_TONE[licenseBadge.tone]}`}>{licenseBadge.label}</span>
              ) : null}
            </div>
          </>
        ) : licenseBadge ? (
          <div className="sm:col-span-2">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${BADGE_TONE[licenseBadge.tone]}`}>{licenseBadge.label}</span>
            <p className="mt-1 text-xs text-text-muted">Belge unvanı ve geçerlilik tarihi alanları veritabanı güncellemesi sonrası açılır.</p>
          </div>
        ) : null}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-iban">
            IBAN <span className="text-text-faint text-xs font-normal">(fatura / ödeme)</span>
          </label>
          <input
            id="tenant-iban"
            name="iban"
            defaultValue={tenant.iban ?? ""}
            className={fieldClass}
            placeholder="TR330006100519786457841326"
            maxLength={32}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-website">Web sitesi</label>
          <input id="tenant-website" name="website" type="url" defaultValue={tenant.website ?? ""} className={fieldClass} placeholder="https://ofisim.com" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-color">Marka rengi</label>
          <div className="flex items-center gap-2">
            <input id="tenant-color" name="brand_color" type="color" defaultValue={tenant.brand_color || "#2563eb"} className="h-11 w-14 cursor-pointer rounded-[var(--radius-control)] border border-line bg-canvas p-1" />
            <span className="text-xs text-text-muted">Panel ve vitrin vurgusunda kullanılır.</span>
          </div>
        </div>

        {error ? <p className="sm:col-span-2 text-sm text-danger-500" role="alert">{error}</p> : null}

        <div className="sm:col-span-2 flex items-center justify-end gap-3 border-t border-line pt-4">
          {saved ? <span className="flex items-center gap-1.5 text-sm font-semibold text-mint-600"><Check className="h-4 w-4" /> Kaydedildi</span> : null}
          <button type="submit" disabled={pending} className="btn-shine inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            <Save className="h-4 w-4" /> {pending ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
          </button>
        </div>
      </form>
    </section>
  );
}
