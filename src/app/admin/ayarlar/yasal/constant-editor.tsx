"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { addLegalConstantAction, deleteLegalConstantAction } from "@/app/actions/legal-admin";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";

type Option = { key: string; label: string; unit: string };

const UNIT: Record<string, string> = { pct: "%", try: "TL", usd: "USD", ha: "hektar", months: "ay", years: "yıl", count: "adet", ratio: "oran" };

/** Mevzuat sabitine geçerlilik tarihli değer ekleme (süper admin). Kaynak zorunlu; geçmiş satırlar değişmez. */
export function ConstantEditor({ options, today }: { options: readonly Option[]; today: string }) {
  const router = useRouter();
  const [key, setKey] = useState(options[0]?.key ?? "");
  const [value, setValue] = useState("");
  const [validFrom, setValidFrom] = useState(today);
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const unit = options.find((o) => o.key === key)?.unit ?? "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await addLegalConstantAction({ key, value, validFrom, source, note });
      if (r.ok) {
        setMsg({ ok: true, text: r.message ?? "Kaydedildi." });
        setValue("");
        setNote("");
        router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 md:grid-cols-6" aria-label="Yeni tarihli değer">
      <FormField label="Sabit" htmlFor="lc-key" className="md:col-span-2">
        <FormSelect id="lc-key" value={key} onChange={(e) => setKey(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label={`Değer${UNIT[unit] ? ` (${UNIT[unit]})` : ""}`} htmlFor="lc-value" required>
        <FormInput id="lc-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ör. 20" />
      </FormField>
      <FormField label="Geçerlilik başlangıcı" htmlFor="lc-from" required hint="Geleceğe tarihli olabilir">
        <FormInput id="lc-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
      </FormField>
      <FormField label="Kaynak" htmlFor="lc-source" required className="md:col-span-2">
        <FormInput id="lc-source" value={source} maxLength={500} onChange={(e) => setSource(e.target.value)} placeholder="Resmî Gazete tarih/sayı, tebliğ" />
      </FormField>
      <FormField label="Not" htmlFor="lc-note" className="md:col-span-4">
        <FormInput id="lc-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <div className="flex items-end md:col-span-2">
        <Button type="submit" icon={Plus} loading={pending} disabled={!value.trim() || !source.trim() || pending}>
          Değeri ekle
        </Button>
      </div>
      {msg ? (
        <p role="status" className={`text-sm md:col-span-6 ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}

/** Henüz yürürlüğe girmemiş kayıtlar (yalnız bunlar silinebilir). */
export function FutureConstantList({ records }: { records: readonly { key: string; value: number; validFrom: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink-950">Planlanan değişiklikler</h3>
      <ul className="mt-2 space-y-1">
        {records.map((r) => (
          <li key={`${r.key}:${r.validFrom}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <code className="text-xs">{r.key}</code> → {r.value} · {r.validFrom}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Trash2}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setErr(null);
                  const res = await deleteLegalConstantAction(r.key, r.validFrom);
                  if (res.ok) router.refresh();
                  else setErr(res.error);
                })
              }
            >
              Sil
            </Button>
          </li>
        ))}
      </ul>
      {err ? <p className="mt-2 text-sm text-danger-600" role="alert">{err}</p> : null}
    </div>
  );
}
