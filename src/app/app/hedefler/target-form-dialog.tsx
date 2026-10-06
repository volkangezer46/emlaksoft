"use client";

import { useActionState, useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import {
  updateTarget,
  type TargetResult,
} from "@/app/actions/targets-openhouse-sources";
import { Combobox } from "@/components/ui/combobox";
import { FormField, Input } from "@/components/ui/input";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

type Member = { id: string; full_name: string };

/** Düzenleme modunda formu dolduran mevcut hedef değerleri. */
export type TargetFormValues = {
  id: string;
  period: string;
  period_start: string;
  target_deals: number;
  target_revenue: number;
  profile_id: string | null;
};

const PERIODS = [
  { value: "monthly",   label: "Aylık" },
  { value: "quarterly", label: "Çeyreklik" },
  { value: "yearly",    label: "Yıllık" },
];

// Kısa listede native <select> tercih edildi (bkz. gorevler/yeni/task-form).
const selectClass =
  "w-full appearance-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/**
 * Hedef DÜZENLEME dialogu (kalem ikon tetikleyici, hızlı alan düzenleme).
 * Yeni hedef ekleme sayfa içi panelde: bkz. target-create-panel.tsx.
 */
export function TargetFormDialog({
  members,
  target,
}: {
  members: Member[];
  target: TargetFormValues;
}) {
  const [open, setOpen] = useState(false);
  // Başarıda kapatma action akışında (bkz. task-edit-dialog): efekt gerektirmez.
  const [state, formAction, pending] = useActionState<TargetResult, FormData>(
    async (prev, fd) => {
      const result = await updateTarget(prev, fd);
      if (result.ok) setOpen(false);
      return result;
    },
    {},
  );

  const defaultMonth = target.period_start.slice(0, 7);

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Hedefi düzenle"
      description="Danışman veya ofis geneli için dönemsel anlaşma ve gelir hedefi."
      icon={<Pencil />}
      action={formAction}
      pending={pending}
      error={state.error}
      summary
      hiddenFields={target ? <input type="hidden" name="id" value={target.id} /> : null}
      fieldLabels={{ period: "Dönem", period_start: "Başlangıç", profile_id: "Danışman", target_deals: "Hedef anlaşma", target_revenue: "Hedef gelir (₺)" }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          aria-label="Hedefi düzenle"
          // relative z-10: kartı kaplayan overlay linkin üstünde kalması için
          className="focus-ring press relative z-10 grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-hairline bg-surface text-text-muted transition hover:border-brand-300 hover:text-accent-text"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
      tabs={[{ id: "hedef", label: "Hedef", fields: ["period", "period_start", "profile_id", "target_deals", "target_revenue"] }]}
      panels={{
        hedef: (
          <>
            <FormField label="Dönem" htmlFor="target-period" required>
              <div className="relative">
                <select id="target-period" name="period" defaultValue={target?.period ?? "monthly"} className={selectClass}>
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              </div>
            </FormField>
            <FormField label="Dönem başlangıcı" htmlFor="target-period-start" required hint="Çeyreklik/yıllık hedefte başlangıç ayını seçin.">
              <Input id="target-period-start" name="period_start" type="month" required defaultValue={defaultMonth} />
            </FormField>
            <FormField label="Danışman" className="sm:col-span-2" hint="Boş bırakılırsa hedef ofis geneli için tanımlanır.">
              <Combobox
                name="profile_id"
                aria-label="Danışman"
                placeholder="Ofis geneli"
                searchPlaceholder="Danışman ara…"
                emptyText="Danışman bulunamadı"
                defaultValue={target?.profile_id ?? ""}
                options={members.map((m) => ({ value: m.id, label: m.full_name }))}
              />
            </FormField>
            <FormField label="Hedef anlaşma" htmlFor="target-deals" required>
              <Input id="target-deals" name="target_deals" type="number" min={0} step={1} required defaultValue={target ? target.target_deals : ""} placeholder="Örn. 5" />
            </FormField>
            <FormField label="Hedef gelir (₺)" htmlFor="target-revenue" required>
              <Input id="target-revenue" name="target_revenue" type="number" min={0} step="any" required defaultValue={target ? target.target_revenue : ""} placeholder="Örn. 250000" />
            </FormField>
          </>
        ),
      }}
    />
  );
}
