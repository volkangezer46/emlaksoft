"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { deleteMarketingSpend, saveMarketingSpend, type SpendResult } from "@/app/actions/channel-roi";

/**
 * Kanal ROI istemci denetimleri: aylık pazarlama harcaması girişi (ay + kanal başına tek tutar; yeniden girilirse
 * güncellenir) ve satır silme (satır içi onay). Kanal seçenekleri sunucudan gelir (istemci kanal sözlüğünü yüklemez).
 */

function Msg({ res }: { res: { ok: boolean; text: string } | null }) {
  if (!res) return null;
  return (
    <span role={res.ok ? "status" : "alert"} className={`text-xs font-semibold ${res.ok ? "text-mint-700" : "text-danger-600"}`}>
      {res.text}
    </span>
  );
}

export function SpendForm({ channels, defaultMonth, defaultChannel, disabled }: { channels: { value: string; label: string }[]; defaultMonth: string; defaultChannel?: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setRes(null);
    start(async () => {
      const r: SpendResult = await saveMarketingSpend(fd);
      if (r.error) {
        setRes({ ok: false, text: r.error });
        return;
      }
      const amount = form.elements.namedItem("amount");
      if (amount instanceof HTMLInputElement) amount.value = "";
      const note = form.elements.namedItem("note");
      if (note instanceof HTMLInputElement) note.value = "";
      setRes({ ok: true, text: "Harcama kaydedildi." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1fr)_10rem_minmax(0,1.4fr)_auto] lg:items-end">
      <FormField label="Ay" htmlFor="spend-month" required>
        <FormInput type="month" name="month" defaultValue={defaultMonth} required disabled={disabled} />
      </FormField>
      <FormField label="Kanal" htmlFor="spend-channel" required>
        <FormSelect name="channel" defaultValue={defaultChannel ?? channels[0]?.value} required disabled={disabled}>
          {channels.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Tutar (TL, KDV hariç)" htmlFor="spend-amount" required>
        <FormInput name="amount" inputMode="decimal" placeholder="12.500" required disabled={disabled} autoComplete="off" />
      </FormField>
      <FormField label="Not" htmlFor="spend-note" hint="İsteğe bağlı: ajans, kampanya adı…">
        <FormInput name="note" maxLength={300} placeholder="ör. Instagram kampanyası" disabled={disabled} autoComplete="off" />
      </FormField>
      <div className="flex flex-col items-start gap-1">
        <Button variant="navy" type="submit" disabled={pending || disabled}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Kaydet
        </Button>
        <Msg res={res} />
      </div>
    </form>
  );
}

export function SpendDeleteButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () => {
    setConfirming(false);
    setRes(null);
    start(async () => {
      const r = await deleteMarketingSpend(id);
      if (r.error) setRes({ ok: false, text: r.error });
      router.refresh();
    });
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {confirming ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs font-semibold text-amber-700">
          Silinsin mi?
          <Button variant="danger" size="xs" type="button" onClick={run}>
            Sil
          </Button>
          <Button variant="outline" size="xs" type="button" onClick={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </span>
      ) : (
        <Button variant="outline" size="xs" type="button" disabled={pending} onClick={() => setConfirming(true)} aria-label={`${label} harcamasını sil`}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Sil
        </Button>
      )}
      <Msg res={res} />
    </span>
  );
}
