"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Copy, Plus, Target } from "lucide-react";
import { copyTargetsFromPrevious, createTarget, createTargetsBulk, type TargetResult } from "@/app/actions/targets";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { FormField, Input } from "@/components/ui/input";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { useToast } from "@/components/app/toast-provider";
import { now, trMonthKey } from "@/lib/clock";

type Member = { id: string; full_name: string };
type Option = { id: string; name: string };

export const TARGET_PANEL_ID = "hedef-ekle";

const PERIODS = [
  { value: "monthly", label: "Aylık" },
  { value: "quarterly", label: "Çeyreklik" },
  { value: "yearly", label: "Yıllık" },
];

/** OA4: hedefin kime ait olduğu. "toplu" = birden çok danışmana tek seferde kişi hedefi. */
const SCOPES = [
  { value: "kisi", label: "Danışman" },
  { value: "toplu", label: "Toplu" },
  { value: "takim", label: "Takım" },
  { value: "sube", label: "Şube" },
  { value: "ofis", label: "Ofis geneli" },
] as const;
type ScopeValue = (typeof SCOPES)[number]["value"];

/** "Yeni hedef" düğmesi (hero: koyu zeminde beyaz, solid: açık zeminde primary). */
export function TargetCreateTrigger({ variant = "solid" }: { variant?: "hero" | "solid" }) {
  return variant === "hero" ? (
    <InlinePanelTrigger
      panelId={TARGET_PANEL_ID}
      className="btn-shine bg-white px-4 py-2.5 font-bold text-text shadow-[var(--elev-2)] hover:bg-white/90"
    >
      <Plus className="h-4 w-4" /> Yeni hedef
    </InlinePanelTrigger>
  ) : (
    <InlinePanelTrigger panelId={TARGET_PANEL_ID}>
      <Plus className="h-4 w-4" /> Yeni hedef
    </InlinePanelTrigger>
  );
}

export function TargetCreatePanel({ members, teams, branches }: { members: Member[]; teams: Option[]; branches: Option[] }) {
  return (
    <InlinePanel
      id={TARGET_PANEL_ID}
      title="Yeni hedef"
      description="Danışman, birden çok danışman, takım, şube ya da ofis geneli için dönemsel hedef. Geçen dönemin hedeflerini tek tıkla kopyalayabilirsiniz."
      icon={<Target />}
    >
      {(close) => <TargetCreateForm members={members} teams={teams} branches={branches} onDone={close} />}
    </InlinePanel>
  );
}

function TargetCreateForm({ members, teams, branches, onDone }: { members: Member[]; teams: Option[]; branches: Option[]; onDone: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [scope, setScope] = useState<ScopeValue>("kisi");
  const [all, setAll] = useState(false);
  const [state, formAction, pending] = useActionState<TargetResult, FormData>(
    async (prev, fd) => {
      const bulk = fd.get("kapsam") === "toplu";
      const result = bulk ? await createTargetsBulk(prev, fd) : await createTarget(prev, fd);
      if (result.ok) {
        push(bulk ? `${result.created ?? 0} hedef eklendi, ${result.updated ?? 0} hedef güncellendi` : "Hedef eklendi", "ok");
        router.refresh();
        onDone();
      }
      return result;
    },
    {},
  );
  const [copyState, copyAction, copying] = useActionState<TargetResult, FormData>(
    async (prev, fd) => {
      const result = await copyTargetsFromPrevious(prev, fd);
      if (result.ok) {
        push(
          result.created
            ? `${result.created} hedef geçen dönemden kopyalandı${result.skipped ? ` · ${result.skipped} zaten vardı` : ""}`
            : "Geçen dönemin hedeflerinin hepsi bu dönemde zaten tanımlı",
          "ok",
        );
        router.refresh();
        onDone();
      }
      return result;
    },
    {},
  );
  const defaultMonth = trMonthKey(now());
  const error = state.error ?? copyState.error;

  return (
    <form action={formAction} className="grid gap-4 p-4 sm:grid-cols-2 md:p-6">
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-xs font-semibold text-text-muted">Kime</legend>
        <div role="radiogroup" aria-label="Hedef kapsamı" className="flex flex-wrap gap-1.5">
          {SCOPES.map((s) => (
            <label
              key={s.value}
              className={`focus-within:ring-2 focus-within:ring-brand-400/40 inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3.5 text-xs font-semibold transition touch:min-h-11 ${
                scope === s.value ? "border-transparent bg-accent text-accent-fg" : "border-line bg-surface text-text-muted hover:bg-surface-hover"
              }`}
            >
              <input type="radio" name="kapsam" value={s.value} checked={scope === s.value} onChange={() => setScope(s.value)} className="peer sr-only" />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>

      <FormField label="Dönem" htmlFor="target-period" required>
        <div className="relative">
          <select id="target-period" name="period" defaultValue="monthly" className="w-full appearance-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface touch:min-h-11 touch:text-base">
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
        </div>
      </FormField>

      <FormField label="Dönem başlangıcı" htmlFor="target-period-start" required hint="Çeyreklik/yıllık hedefte başlangıç ayını seçin.">
        <Input id="target-period-start" name="period_start" type="month" required defaultValue={defaultMonth} />
      </FormField>

      {scope === "kisi" ? (
        <FormField label="Danışman" className="sm:col-span-2" required>
          <Combobox
            name="profile_id"
            required
            aria-label="Danışman"
            placeholder="Danışman seçin"
            searchPlaceholder="Danışman ara…"
            emptyText="Danışman bulunamadı"
            defaultValue=""
            options={members.map((m) => ({ value: m.id, label: m.full_name }))}
          />
        </FormField>
      ) : null}

      {scope === "takim" ? (
        <FormField label="Takım" className="sm:col-span-2" required hint={teams.length === 0 ? "Ofiste tanımlı takım yok; Ekibim > Takımlar'dan ekleyebilirsiniz." : "Gerçekleşme takım üyelerinin toplamıdır."}>
          <Combobox
            name="team_id"
            required
            aria-label="Takım"
            placeholder="Takım seçin"
            searchPlaceholder="Takım ara…"
            emptyText="Takım bulunamadı"
            defaultValue=""
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
          />
        </FormField>
      ) : null}

      {scope === "sube" ? (
        <FormField label="Şube" className="sm:col-span-2" required hint={branches.length === 0 ? "Ofiste tanımlı şube yok." : "Gerçekleşme şube danışmanlarının toplamıdır."}>
          <Combobox
            name="branch_id"
            required
            aria-label="Şube"
            placeholder="Şube seçin"
            searchPlaceholder="Şube ara…"
            emptyText="Şube bulunamadı"
            defaultValue=""
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        </FormField>
      ) : null}

      {scope === "toplu" ? (
        <div className="grid gap-3 sm:col-span-2">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-text">
            <Checkbox name="tum" value="1" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} />
            Tüm aktif danışmanlar ({members.length})
          </label>
          {!all ? (
            <fieldset className="max-h-56 overflow-y-auto rounded-[var(--radius-card)] border border-line p-2">
              <legend className="sr-only">Danışmanlar</legend>
              <div className="grid gap-0.5 sm:grid-cols-2">
                {members.map((m) => (
                  <label key={m.id} className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm text-text hover:bg-surface-hover touch:min-h-11">
                    <Checkbox name="profile_ids" value={m.id} />
                    <span className="truncate">{m.full_name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-text-muted">Değerler</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <label className="inline-flex min-h-11 items-center gap-2">
                <input type="radio" name="dagitim" value="ayni" defaultChecked className="h-4 w-4 accent-[var(--accent)] touch:h-5 touch:w-5" /> Her danışmana aynı hedef
              </label>
              <label className="inline-flex min-h-11 items-center gap-2">
                <input type="radio" name="dagitim" value="esit" className="h-4 w-4 accent-[var(--accent)] touch:h-5 touch:w-5" /> Girilen toplamı eşit dağıt
              </label>
            </div>
          </fieldset>
          <p className="text-xs text-text-muted">Seçili danışmanın bu dönemde hedefi varsa yenisi eklenmez, mevcut hedef güncellenir.</p>
        </div>
      ) : null}

      <FormField label="Hedef anlaşma" htmlFor="target-deals" required>
        <Input id="target-deals" name="target_deals" type="number" min={0} step={1} required placeholder="Örn. 5" />
      </FormField>
      <FormField label="Hedef gelir (₺)" htmlFor="target-revenue" required>
        <Input id="target-revenue" name="target_revenue" type="number" min={0} step="any" required placeholder="Örn. 250000" />
      </FormField>
      <FormField label="Hedef randevu" htmlFor="target-appointments" hint="Gösterim/görüşme sayısı (0 = takip edilmez).">
        <Input id="target-appointments" name="target_appointments" type="number" min={0} step={1} defaultValue={0} />
      </FormField>
      <FormField label="Hedef çağrı" htmlFor="target-calls" hint="Dönemde yapılan/alınan çağrı (0 = takip edilmez).">
        <Input id="target-calls" name="target_calls" type="number" min={0} step={1} defaultValue={0} />
      </FormField>
      <FormField label="Hedef yeni portföy" htmlFor="target-listings" hint="Dönemde eklenen portföy (0 = takip edilmez).">
        <Input id="target-listings" name="target_listings" type="number" min={0} step={1} defaultValue={0} />
      </FormField>
      <FormField label="Not" htmlFor="target-notes">
        <Input id="target-notes" name="notes" maxLength={1000} placeholder="Örn. Kadıköy bölgesine odak" />
      </FormField>

      {error ? (
        <p className="text-xs font-semibold text-danger-600 sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}

      <div className="hairline-t flex flex-wrap items-center justify-between gap-2 pt-4 sm:col-span-2">
        <Button
          type="submit"
          variant="outline"
          icon={Copy}
          formAction={copyAction}
          formNoValidate
          loading={copying}
          title="Seçili dönemin bir öncekindeki tüm hedefleri bu döneme kopyalar"
        >
          Geçen dönemden kopyala
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onDone}>
            Vazgeç
          </Button>
          <Button type="submit" loading={pending}>
            {scope === "toplu" ? "Hedefleri ekle" : "Hedefi ekle"}
          </Button>
        </div>
      </div>
    </form>
  );
}
