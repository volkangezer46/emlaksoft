"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPropertyStatus } from "@/app/actions/properties";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";

/**
 * Portföy durumu (Durum yönetimi). Sonuç bildirilir: başarıda durum adıyla onay + yayına alınınca "Portal bağla"
 * sonraki adımı; hata satır içinde ve bildirimde görünür (eskiden yetki/RPC hatası sessizce yutuluyordu).
 * Yayın kapısı engelinde sunucu, eksiklerin anlatıldığı İlan sahibi sekmesine yönlendirir.
 */
export function PropertyStatusForm({
  propertyId,
  status,
  options,
}: {
  propertyId: string;
  status: string;
  options: readonly { value: string; label: string }[];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await setPropertyStatus(fd);
      if (res?.error) {
        setError(res.error);
        push(res.error, "err");
        return;
      }
      const label = options.find((o) => o.value === value)?.label ?? value;
      if (value === "live") {
        push("Portföy yayına alındı; vitrinde görünür.", "ok", {
          action: { label: "Portal bağla", onClick: () => router.push(`/app/portfoyler/${propertyId}?sekme=portallar#portal-bagla`) },
        });
      } else {
        push(`Durum güncellendi: ${label}`, "ok");
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} aria-busy={pending} className="mt-5 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={propertyId} />
      <label className="min-w-[160px] flex-1 text-xs font-medium text-text-muted">
        Durum
        <select
          name="status"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1.5 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand-400 touch:min-h-11"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="navy" size="lg" loading={pending} disabled={value === status}>
        {pending ? "Kaydediliyor…" : "Kaydet"}
      </Button>
      {error ? <p role="alert" className="basis-full text-sm font-medium text-danger-600">{error}</p> : null}
    </form>
  );
}
