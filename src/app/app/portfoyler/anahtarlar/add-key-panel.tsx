"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { searchProperties } from "@/app/actions/lookup";
import { addPropertyKey } from "@/app/actions/property-keys";

/** Anahtar panosundan yeni anahtar: portföy seçilir, sayfa içi panel (popup yok). */
export function AddKeyPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(fd: FormData) {
    setError(null);
    if (!String(fd.get("property_id") ?? "").trim()) {
      setError("Önce portföy seçin.");
      return;
    }
    startTransition(async () => {
      const res = await addPropertyKey({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Yeni anahtar"
      description="Ana kapı, bina girişi ya da yedek anahtarı bir portföye kaydedin."
      icon={<KeyRound />}
      onSubmit={onSubmit}
      pending={pending}
      error={error}
      submitLabel="Anahtarı ekle"
      fieldLabels={{ property_id: "Portföy", label: "Etiket", key_code: "Anahtar kodu", note: "Not" }}
      trigger={({ onClick, ...aria }) => (
        <Button type="button" onClick={onClick} {...aria}>
          <Plus className="h-4 w-4" /> Yeni anahtar
        </Button>
      )}
      tabs={[{ id: "anahtar", label: "Anahtar", icon: KeyRound, fields: ["property_id", "label", "key_code", "note"] }]}
      panels={{
        anahtar: (
          <>
            <FormField label="Portföy" htmlFor="ak-property" required className="sm:col-span-2">
              <Combobox
                id="ak-property"
                name="property_id"
                aria-label="Portföy"
                placeholder="Portföy kodu veya başlıkla ara…"
                searchPlaceholder="En az 2 karakter yazın…"
                emptyText="Aramak için en az 2 karakter yazın"
                onSearch={searchProperties}
                options={[] as ComboboxOption[]}
              />
            </FormField>
            <FormField label="Etiket" htmlFor="ak-label" required>
              <FormInput name="label" required maxLength={80} placeholder="Örn. Ana kapı" />
            </FormField>
            <FormField label="Anahtar kodu" htmlFor="ak-code">
              <FormInput name="key_code" maxLength={40} placeholder="Etiket / numara" />
            </FormField>
            <FormField label="Not" htmlFor="ak-note" className="sm:col-span-2">
              <FormInput name="note" maxLength={500} placeholder="Opsiyonel" />
            </FormField>
          </>
        ),
      }}
    />
  );
}
