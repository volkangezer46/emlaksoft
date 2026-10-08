"use client";

import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { createChallenge, type LeagueResult } from "@/app/actions/league";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";

export type MetricOption = { value: string; label: string };

const selectClass =
  "surface-sunken w-full rounded-[var(--radius-control)] border border-hairline px-3 py-[0.4375rem] touch:min-h-11 text-sm text-ink-950 focus:border-brand-400 focus:outline-none";

/**
 * Yeni meydan okuma formu — başlangıç/bitiş varsayılanları sunucudan gelir (bileşende saat okunmaz).
 * Ölçüt: lig puan kurallarından biri (adet sayılır). Bitiş tarihi dahildir.
 */
export function ChallengeForm({
  metrics,
  defaultStart,
  defaultEnd,
}: {
  metrics: MetricOption[];
  defaultStart: string;
  defaultEnd: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<LeagueResult, FormData>(async (prev, fd) => {
    const result = await createChallenge(prev, fd);
    if (result.ok) {
      formRef.current?.reset();
      router.refresh();
    }
    return result;
  }, {});

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <FormField label="Başlık" htmlFor="ch-title" required className="sm:col-span-2">
        <Input id="ch-title" name="title" required minLength={3} maxLength={120} placeholder="Bu ay 20 yeni yetkili portföy" />
      </FormField>
      <FormField label="Ölçüt (adet sayılır)" htmlFor="ch-metric" required>
        <select id="ch-metric" name="metric" defaultValue="listing_authorized" className={selectClass}>
          {metrics.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Kapsam" htmlFor="ch-scope" required hint="Ekip: herkesin toplamı hedefe gider. Bireysel: hedefe ilk ulaşan kazanır.">
        <select id="ch-scope" name="scope" defaultValue="team" className={selectClass}>
          <option value="team">Ekip (ortak hedef)</option>
          <option value="individual">Bireysel (yarış)</option>
        </select>
      </FormField>
      <FormField label="Hedef (adet)" htmlFor="ch-target" required>
        <Input id="ch-target" name="target_value" type="number" inputMode="numeric" min={1} max={100000} required defaultValue={20} />
      </FormField>
      <FormField label="Ödül (serbest metin)" htmlFor="ch-reward">
        <Input id="ch-reward" name="reward_text" maxLength={200} placeholder="Ör. Ekip yemeği" />
      </FormField>
      <FormField label="Başlangıç" htmlFor="ch-start" required>
        <Input id="ch-start" name="starts_on" type="date" required defaultValue={defaultStart} />
      </FormField>
      <FormField label="Bitiş (dahil)" htmlFor="ch-end" required>
        <Input id="ch-end" name="ends_on" type="date" required defaultValue={defaultEnd} />
      </FormField>
      <FormField label="Açıklama" htmlFor="ch-desc" className="sm:col-span-2">
        <Textarea id="ch-desc" name="description" maxLength={500} rows={2} />
      </FormField>

      {state.error ? <Alert tone="danger" title={state.error} className="sm:col-span-2" /> : null}
      {state.ok ? <Alert tone="success" title="Meydan okuma açıldı." className="sm:col-span-2" /> : null}

      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" icon={Rocket} loading={pending}>
          Meydan okumayı başlat
        </Button>
      </div>
    </form>
  );
}
