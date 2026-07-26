"use client";

import { useActionState, useState } from "react";
import { ChevronDown, Pencil, Plus, Target } from "lucide-react";
import {
  createTarget,
  updateTarget,
  type TargetResult,
} from "@/app/actions/targets-openhouse-sources";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField, Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

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

// Kısa listede native <select> tercih edildi (bkz. gorevler/new-task-dialog).
const selectClass =
  "w-full appearance-none rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/**
 * Hedef oluşturma + düzenleme dialogu.
 * `target` verilirse düzenleme modunda açılır (kalem ikon tetikleyici),
 * verilmezse "Yeni hedef" tetikleyicisi render edilir.
 */
export function TargetFormDialog({
  members,
  target,
  triggerVariant = "solid",
}: {
  members: Member[];
  target?: TargetFormValues;
  /** "hero": koyu hero üstündeki beyaz buton; "solid": açık zeminde primary buton. */
  triggerVariant?: "hero" | "solid";
}) {
  const [open, setOpen] = useState(false);
  // Başarıda kapatma action akışında (bkz. task-edit-dialog): efekt gerektirmez.
  const [state, formAction, pending] = useActionState<TargetResult, FormData>(
    async (prev, fd) => {
      const result = target ? await updateTarget(prev, fd) : await createTarget(prev, fd);
      if (result.ok) setOpen(false);
      return result;
    },
    {},
  );

  const defaultMonth = target
    ? target.period_start.slice(0, 7)
    : new Date().toISOString().slice(0, 7);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {target ? (
          <button
            type="button"
            aria-label="Hedefi düzenle"
            // relative z-10: kartı kaplayan overlay linkin üstünde kalması için
            className="focus-ring press relative z-10 grid h-8 w-8 place-items-center rounded-[9px] border border-hairline bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : triggerVariant === "hero" ? (
          <button
            type="button"
            className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 shadow-[var(--elev-2)]"
          >
            <Plus className="h-4 w-4" /> Yeni hedef
          </button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" /> Yeni hedef
          </Button>
        )}
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={target ? <Pencil /> : <Target />}
          title={target ? "Hedefi düzenle" : "Yeni hedef"}
          description="Danışman veya ofis geneli için dönemsel anlaşma ve gelir hedefi."
        />
        <form action={formAction}>
          {target ? <input type="hidden" name="id" value={target.id} /> : null}
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Dönem" htmlFor="target-period" required>
              <div className="relative">
                <select
                  id="target-period"
                  name="period"
                  defaultValue={target?.period ?? "monthly"}
                  className={selectClass}
                >
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
              <Input
                id="target-period-start"
                name="period_start"
                type="month"
                required
                defaultValue={defaultMonth}
              />
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
                defaultValue={target?.profile_id ?? ""}
                options={members.map((m) => ({ value: m.id, label: m.full_name }))}
              />
            </FormField>

            <FormField label="Hedef anlaşma" htmlFor="target-deals" required>
              <Input
                id="target-deals"
                name="target_deals"
                type="number"
                min={0}
                step={1}
                required
                defaultValue={target ? target.target_deals : ""}
                placeholder="Örn. 5"
              />
            </FormField>

            <FormField label="Hedef gelir (₺)" htmlFor="target-revenue" required>
              <Input
                id="target-revenue"
                name="target_revenue"
                type="number"
                min={0}
                step="any"
                required
                defaultValue={target ? target.target_revenue : ""}
                placeholder="Örn. 250000"
              />
            </FormField>

            {state.error ? (
              <p className="text-xs font-semibold text-danger-600 sm:col-span-2" role="alert">
                {state.error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Vazgeç</Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              {target ? "Kaydet" : "Hedefi ekle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
