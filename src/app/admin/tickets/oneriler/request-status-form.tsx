"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect } from "@/components/ui/form-controls";
import { setFeatureRequestStatus } from "@/app/actions/platform-feedback";

/** Öneri satırı: durum (planlandı / yapılıyor / yayında ...) + ofislere görünen kısa not. Değişince önerene bildirim gider. */
export function RequestStatusForm({ id, status, note, options }: { id: string; status: string; note: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = await setFeatureRequestStatus(fd);
          if (r.error) setError(r.error);
          else router.refresh();
        });
      }}
    >
      <input type="hidden" name="id" value={id} />
      <FormSelect name="status" defaultValue={status} aria-label="Öneri durumu" className="w-auto">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </FormSelect>
      <FormInput name="admin_note" defaultValue={note} maxLength={600} placeholder="Ofislere not (isteğe bağlı)" aria-label="Ofislere görünen not" className="min-w-0 flex-1 sm:w-64" />
      <Button type="submit" variant="navy" size="sm" disabled={pending}>
        {pending ? "…" : "Kaydet"}
      </Button>
      {error ? <span role="alert" className="text-xs font-semibold text-danger-600">{error}</span> : null}
    </form>
  );
}
