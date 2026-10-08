"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { saveLeagueSettings, type LeagueResult } from "@/app/actions/league";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export type RuleFormItem = { key: string; label: string; hint: string; points: number; defaultPoints: number };

/**
 * Lig puan kuralları formu (yalnız Hedefler/düzenle izni olanlara çizilir; sunucu action ayrıca denetler).
 * 0 puan = kural kapalı. Tutar bazlı sıralama (P12) bilinçli açılır; varsayılan kapalıdır.
 */
export function LeagueRulesForm({ items, showAmounts }: { items: RuleFormItem[]; showAmounts: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LeagueResult, FormData>(async (prev, fd) => {
    const result = await saveLeagueSettings(prev, fd);
    if (result.ok) router.refresh();
    return result;
  }, {});

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <label
            key={it.key}
            htmlFor={`rule_${it.key}`}
            className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text">{it.label}</span>
              <span className="block text-xs text-text-muted">{it.hint}</span>
              <span className="block text-xs text-text-faint">Varsayılan: {it.defaultPoints}</span>
            </span>
            <Input
              id={`rule_${it.key}`}
              name={`rule_${it.key}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={1000}
              step={1}
              defaultValue={it.points}
              className="w-20 shrink-0 text-right"
              aria-label={`${it.label} puanı`}
            />
          </label>
        ))}
      </div>

      <label className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-3">
        <Checkbox name="show_amounts" defaultChecked={showAmounts} className="mt-0.5" />
        <span>
          <span className="block text-sm font-semibold text-text">Tutar bazlı sıralamayı aç</span>
          <span className="block text-xs text-text-muted">
            Kapalıyken ligde yalnız puan ve adetler görünür; ciro/komisyon payı ligde GÖSTERİLMEZ (kazanç gizliliği).
            Açarsanız lig tablosuna, kendi kazançlarını görme yetkisi olanlar için ek bir tutar sütunu gelir.
          </span>
        </span>
      </label>

      {state.error ? <Alert tone="danger" title={state.error} /> : null}
      {state.ok ? <Alert tone="success" title="Lig kuralları kaydedildi." /> : null}

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Kuralları kaydet
        </Button>
      </div>
    </form>
  );
}
