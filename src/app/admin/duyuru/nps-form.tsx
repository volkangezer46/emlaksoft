"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { saveNpsSurvey, setNpsSurveyActive } from "@/app/actions/platform-feedback";
import { SegmentBuilder, type SegmentInit, type SegmentOptions } from "./segment-builder";

export type NpsInit = { id: string; question: string; startsLocal: string; endsLocal: string };

/**
 * NPS anketi formu (DG8): soru, yayın aralığı ve hedef segment (AD8 segment oluşturucusu; boş = tüm ofisler,
 * "yalnız sahipler" anketi sahiplere sınırlar). Sıklık sınırı anket başına değil kullanıcı başınadır (ayar).
 */
export function NpsForm({ options, init, segInit, minLocal, defaultQuestion }: { options: SegmentOptions; init?: NpsInit; segInit?: SegmentInit; minLocal: string; defaultQuestion: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <form
      id="nps-formu"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        setDone(null);
        start(async () => {
          const r = await saveNpsSurvey(fd);
          if (r.error) {
            setError(r.error);
            return;
          }
          setDone(r.affected ? `Kaydedildi: ${r.affected} ofiste sorulacak.` : "Kaydedildi: tüm ofislerde sorulacak.");
          router.push("/admin/duyuru?sekme=nps");
          router.refresh();
        });
      }}
      className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5"
    >
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <Smile className="h-4 w-4 text-brand-600" aria-hidden /> {init ? "NPS anketini düzenle" : "Yeni NPS anketi"}
      </h2>
      {init ? <input type="hidden" name="id" value={init.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Soru" htmlFor="nps-question" required hint="0-10 ölçeğiyle sorulur; ardından isteğe bağlı yorum" className="sm:col-span-2">
          <FormInput id="nps-question" name="question" required minLength={10} maxLength={200} defaultValue={init?.question ?? defaultQuestion} />
        </FormField>
        <FormField label="Başlangıç" htmlFor="nps-starts" hint="Boş: hemen (Türkiye saati)">
          <FormInput id="nps-starts" name="starts_at" type="datetime-local" defaultValue={init?.startsLocal} />
        </FormField>
        <FormField label="Bitiş" htmlFor="nps-ends" hint="Boş: kaldırılana kadar">
          <FormInput id="nps-ends" name="ends_at" type="datetime-local" min={minLocal} defaultValue={init?.endsLocal} />
        </FormField>
      </div>
      <details className="rounded-[var(--radius-control)] border border-line p-3" open={Boolean(segInit && Object.values(segInit).some((v) => (Array.isArray(v) ? v.length : Boolean(v))))}>
        <summary className="cursor-pointer text-sm font-semibold text-ink-950">Hedef kitle (boş bırakılırsa tüm ofislerin tüm kullanıcıları)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <SegmentBuilder options={options} init={segInit} allowUser={false} />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="navy" size="md" disabled={pending}>
          {pending ? "Kaydediliyor…" : init ? "Değişiklikleri kaydet" : "Anketi yayınla"}
        </Button>
        {error ? <span role="alert" className="text-sm font-semibold text-danger-600">{error}</span> : null}
        {done ? <span role="status" className="text-sm font-semibold text-mint-600">{done}</span> : null}
      </div>
    </form>
  );
}

/** Liste satırındaki yayından kaldır / yeniden aç düğmesi. */
export function NpsToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("id", id);
            fd.set("active", active ? "0" : "1");
            const r = await setNpsSurveyActive(fd);
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? "…" : active ? "Yayından kaldır" : "Yeniden yayınla"}
      </Button>
      {error ? <span role="alert" className="text-xs font-semibold text-danger-600">{error}</span> : null}
    </span>
  );
}
