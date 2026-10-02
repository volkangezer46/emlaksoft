"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Target } from "lucide-react";
import { createTarget, type TargetResult } from "@/app/actions/targets-openhouse-sources";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField, Input } from "@/components/ui/input";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { now } from "@/lib/clock";

type Member = { id: string; full_name: string };

export const TARGET_PANEL_ID = "hedef-ekle";

const PERIODS = [
  { value: "monthly", label: "Aylık" },
  { value: "quarterly", label: "Çeyreklik" },
  { value: "yearly", label: "Yıllık" },
];

const selectClass =
  "w-full appearance-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/** "Yeni hedef" düğmesi (hero: koyu zeminde beyaz, solid: açık zeminde primary). */
export function TargetCreateTrigger({ variant = "solid" }: { variant?: "hero" | "solid" }) {
  return variant === "hero" ? (
    <InlinePanelTrigger
      panelId={TARGET_PANEL_ID}
      className="btn-shine bg-white px-4 py-2.5 font-bold text-ink-950 shadow-[var(--elev-2)] hover:bg-white/90"
    >
      <Plus className="h-4 w-4" /> Yeni hedef
    </InlinePanelTrigger>
  ) : (
    <InlinePanelTrigger panelId={TARGET_PANEL_ID}>
      <Plus className="h-4 w-4" /> Yeni hedef
    </InlinePanelTrigger>
  );
}

export function TargetCreatePanel({ members }: { members: Member[] }) {
  return (
    <InlinePanel
      id={TARGET_PANEL_ID}
      title="Yeni hedef"
      description="Danışman veya ofis geneli için dönemsel anlaşma ve gelir hedefi."
      icon={<Target />}
    >
      {(close) => <TargetCreateForm members={members} onDone={close} />}
    </InlinePanel>
  );
}

function TargetCreateForm({ members, onDone }: { members: Member[]; onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<TargetResult, FormData>(
    async (prev, fd) => {
      const result = await createTarget(prev, fd);
      if (result.ok) {
        router.refresh();
        onDone();
      }
      return result;
    },
    {},
  );
  const defaultMonth = new Date(now()).toISOString().slice(0, 7);

  return (
    <form action={formAction} className="grid gap-4 p-4 sm:grid-cols-2 md:p-6">
      <FormField label="Dönem" htmlFor="target-period" required>
        <div className="relative">
          <select id="target-period" name="period" defaultValue="monthly" className={selectClass}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
        </div>
      </FormField>

      <FormField
        label="Dönem başlangıcı"
        htmlFor="target-period-start"
        required
        hint="Çeyreklik/yıllık hedefte başlangıç ayını seçin."
      >
        <Input id="target-period-start" name="period_start" type="month" required defaultValue={defaultMonth} />
      </FormField>

      <FormField
        label="Danışman"
        className="sm:col-span-2"
        hint="Boş bırakılırsa hedef ofis geneli için tanımlanır."
      >
        <Combobox
          name="profile_id"
          aria-label="Danışman"
          placeholder="Ofis geneli"
          searchPlaceholder="Danışman ara…"
          emptyText="Danışman bulunamadı"
          defaultValue=""
          options={members.map((m) => ({ value: m.id, label: m.full_name }))}
        />
      </FormField>

      <FormField label="Hedef anlaşma" htmlFor="target-deals" required>
        <Input id="target-deals" name="target_deals" type="number" min={0} step={1} required placeholder="Örn. 5" />
      </FormField>

      <FormField label="Hedef gelir (₺)" htmlFor="target-revenue" required>
        <Input id="target-revenue" name="target_revenue" type="number" min={0} step="any" required placeholder="Örn. 250000" />
      </FormField>

      {state.error ? (
        <p className="text-xs font-semibold text-danger-600 sm:col-span-2" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="hairline-t flex justify-end gap-2 pt-4 sm:col-span-2">
        <Button variant="secondary" onClick={onDone}>Vazgeç</Button>
        <Button type="submit" loading={pending}>Hedefi ekle</Button>
      </div>
    </form>
  );
}
