"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { submitFeatureRequest, voteFeatureRequest } from "@/app/actions/product-feedback";

/** Yeni öneri formu: başlık + isteğe bağlı açıklama. Önce yalnız sizin ofisinize görünür (EmlakSoft inceler). */
export function FeatureRequestForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        setError(null);
        setDone(false);
        start(async () => {
          const r = await submitFeatureRequest(fd);
          if (r.error) {
            setError(r.error);
            return;
          }
          form.reset();
          setDone(true);
          router.refresh();
        });
      }}
      className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5"
    >
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
        <Lightbulb className="h-5 w-5 text-brand-600" aria-hidden /> Öneri yazın
      </h2>
      <FormField label="Ne olsun istersiniz?" htmlFor="oneri-baslik" required>
        <FormInput id="oneri-baslik" name="title" required minLength={5} maxLength={120} placeholder="Örn. Portföy sunumuna kat planı ekleme" />
      </FormField>
      <FormField label="Ayrıntı (isteğe bağlı)" htmlFor="oneri-aciklama" hint="Hangi işi kolaylaştıracağını yazarsanız önceliklendirmemiz kolaylaşır">
        <FormTextarea id="oneri-aciklama" name="body" rows={3} maxLength={2000} />
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="md" disabled={pending}>
          {pending ? "Gönderiliyor…" : "Öneriyi gönder"}
        </Button>
        {error ? <span role="alert" className="text-sm font-semibold text-danger-600">{error}</span> : null}
        {done ? (
          <span role="status" className="text-sm font-semibold text-mint-600">
            Teşekkürler! Öneriniz incelendikten sonra tüm ofislerin oylamasına açılır.
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** Oy düğmesi: ofis başına tek oy (aynı ofisten ikinci oy sayılmaz); tıklayınca anında güncellenir. */
export function VoteButton({ id, voted, count, disabled }: { id: string; voted: boolean; count: number; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState({ voted, count });
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-center gap-1">
      <Button
        variant={state.voted ? "primary" : "secondary"}
        size="md"
        aria-pressed={state.voted}
        aria-label={state.voted ? `Oyu geri al (${state.count} oy)` : `Oy ver (${state.count} oy)`}
        disabled={disabled || pending}
        onClick={() => {
          const next = !state.voted;
          const prev = state;
          setError(null);
          setState({ voted: next, count: Math.max(0, state.count + (next ? 1 : -1)) });
          start(async () => {
            const r = await voteFeatureRequest(id, next);
            if (r.error) {
              setState(prev);
              setError(r.error);
              return;
            }
            setState({ voted: next, count: r.votes ?? prev.count });
            router.refresh();
          });
        }}
        className="h-auto min-h-11 min-w-12 flex-col gap-0.5 px-2 py-1 text-xs"
      >
        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
        <span className="numeric">{state.count}</span>
      </Button>
      {error ? <span role="alert" className="max-w-24 text-center text-xs text-danger-600">{error}</span> : null}
    </span>
  );
}
