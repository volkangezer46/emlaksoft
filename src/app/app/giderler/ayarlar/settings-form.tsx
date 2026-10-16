"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFinanceSettings } from "@/app/actions/expense-budgets";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";

export type FinanceSettingsValue = {
  defaultVatRate: number;
  vatIncludedDefault: boolean;
  ocrEnabled: boolean;
  forecastMinBalance: number | null;
};

/** Genel muhasebe ayarları: KDV varsayılanı, tutar KDV dahil mi, nakit uyarı eşiği (fiş okuma ayrı kartta). */
export function FinanceSettingsForm({ value, canEdit }: { value: FinanceSettingsValue; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [vat, setVat] = useState(String(value.defaultVatRate));
  const [included, setIncluded] = useState(value.vatIncludedDefault);
  const [minBalance, setMinBalance] = useState(value.forecastMinBalance ? String(value.forecastMinBalance).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await saveFinanceSettings({ defaultVatRate: vat, vatIncludedDefault: included, forecastMinBalance: minBalance });
      if (!res.ok) return setError(res.error);
      push("Muhasebe ayarları kaydedildi", "ok");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-busy={pending}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Varsayılan KDV oranı" htmlFor="fs-vat" hint="Yeni kayıt penceresinde önceden seçili gelir.">
          <FormSelect id="fs-vat" value={vat} onChange={(e) => setVat(e.target.value)} disabled={!canEdit}>
            <option value="20">%20</option>
            <option value="10">%10</option>
            <option value="1">%1</option>
            <option value="0">KDV yok (%0)</option>
          </FormSelect>
        </FormField>
        <FormField label="Nakit uyarı eşiği (TL)" htmlFor="fs-min" hint="Tahminde bakiye bunun altına inerse uyarı gösterilir. Boş: uyarı yok.">
          <FormInput id="fs-min" inputMode="decimal" autoComplete="off" maxLength={16} placeholder="Örn. 50.000" value={minBalance} onChange={(e) => setMinBalance(e.target.value)} disabled={!canEdit} />
        </FormField>
      </div>
      <ToggleRow
        id="fs-included"
        title="Girilen tutar KDV dahil"
        text="Açıkken yazdığınız tutar KDV dahil sayılır ve KDV içinden ayrılır; kapalıyken KDV tutarın üstüne eklenir."
        checked={included}
        onChange={setIncluded}
        disabled={!canEdit}
      />
      <FormError error={error} nextStep={null} />
      {canEdit ? (
        <div>
          <Button type="submit" loading={pending}>
            Ayarları kaydet
          </Button>
        </div>
      ) : (
        <p className="text-xs text-text-muted">Ayarları değiştirmek için muhasebe düzenleme yetkisi gerekir.</p>
      )}
    </form>
  );
}

function ToggleRow({ id, title, text, checked, onChange, disabled }: { id: string; title: string; text: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-semibold text-text">{title}</p>
        <p id={`${id}-text`} className="mt-0.5 text-xs text-text-muted">{text}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-labelledby={`${id}-label`} aria-describedby={`${id}-text`} />
    </div>
  );
}
