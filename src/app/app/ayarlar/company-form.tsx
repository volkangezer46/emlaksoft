"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Save } from "lucide-react";
import { updateTenantInfo } from "@/app/actions/settings";

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
  logo_url?: string | null;
  website?: string | null;
};

const fieldClass =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

export function CompanyForm({ tenant }: { tenant: Tenant }) {
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
    <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-4 md:p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-brand-600/10 text-brand-600"><Building2 className="h-5 w-5" /></span>
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
          <input id="tenant-phone" name="phone" type="tel" defaultValue={tenant.phone ?? ""} className={fieldClass} placeholder="+90 555 123 4567" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="tenant-city">Şehir</label>
          <input id="tenant-city" name="city" defaultValue={tenant.city ?? ""} className={fieldClass} placeholder="İstanbul" />
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
          <input id="tenant-license" name="license_no" defaultValue={tenant.license_no ?? ""} className={fieldClass} placeholder="TR-46-00123" />
        </div>
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
            <input id="tenant-color" name="brand_color" type="color" defaultValue={tenant.brand_color || "#2563eb"} className="h-11 w-14 cursor-pointer rounded-[10px] border border-line bg-canvas p-1" />
            <span className="text-xs text-text-muted">Panel ve vitrin vurgusunda kullanılır.</span>
          </div>
        </div>

        {error ? <p className="sm:col-span-2 text-sm text-danger-500" role="alert">{error}</p> : null}

        <div className="sm:col-span-2 flex items-center justify-end gap-3 border-t border-line pt-4">
          {saved ? <span className="flex items-center gap-1.5 text-sm font-semibold text-mint-600"><Check className="h-4 w-4" /> Kaydedildi</span> : null}
          <button type="submit" disabled={pending} className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            <Save className="h-4 w-4" /> {pending ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
          </button>
        </div>
      </form>
    </section>
  );
}
