"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FilterChip } from "@/components/ui/filter-chip";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { searchTenantsBroadcast } from "@/app/actions/platform-notifications";
import { deleteFeatureFlagRule, saveFeatureFlagRule } from "@/app/actions/feature-flag-rules";

export type FlagTargetingInit = {
  tenants: { id: string; name: string }[];
  plans: string[];
  percentage: number;
  startsLocal: string;
  endsLocal: string;
  note: string;
};

/**
 * Hedefleme kuralı formu (DG8): ofis listesi, plan, yüzde ve zaman penceresi. Kural yoksa bayrak genel anahtarla
 * herkese uygulanır; kural varsa yalnız kurala uyan ofislerde açıktır. Yazım gerekçeyle denetim izine düşer.
 */
export function FlagTargetingForm({
  flagKey,
  label,
  globalOn,
  init,
  planOptions,
  canEdit,
}: {
  flagKey: string;
  label: string;
  globalOn: boolean;
  init: FlagTargetingInit | null;
  planOptions: { value: string; label: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tenants, setTenants] = useState(init?.tenants ?? []);
  const [plans, setPlans] = useState<string[]>(init?.plans ?? []);
  const [percentage, setPercentage] = useState(String(init?.percentage ?? 0));
  const [startsLocal, setStartsLocal] = useState(init?.startsLocal ?? "");
  const [endsLocal, setEndsLocal] = useState(init?.endsLocal ?? "");
  const [note, setNote] = useState(init?.note ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const id = `hedef-${flagKey}`;

  const addTenant = (value: string) => {
    setPick("");
    if (!value || tenants.some((t) => t.id === value)) return;
    const opt = options.find((o) => o.value === value);
    setTenants((prev) => [...prev, { id: value, name: opt?.label ?? "Seçili ofis" }]);
  };

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, okText: string) => {
    setError(null);
    setDone(null);
    start(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        return;
      }
      setDone(okText);
      setReason("");
      router.refresh();
    });
  };

  return (
    <form
      id={id}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            saveFeatureFlagRule({
              flagKey,
              tenantIds: tenants.map((t) => t.id),
              plans,
              percentage: Number(percentage || 0),
              startsLocal,
              endsLocal,
              note,
              reason,
            }),
          "Hedefleme kaydedildi.",
        );
      }}
      className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5"
    >
      <div className="flex items-start gap-3">
        <Crosshair className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-bold text-ink-950">{label}</h3>
          <p className="text-xs text-text-muted">
            {init ? "Kural var: yalnız kurala uyan ofislerde açık." : "Kural yok: genel anahtar açıkken tüm ofislerde açık."}
            {globalOn ? "" : " Genel anahtar KAPALI: kural kaydedilir ama anahtar açılana kadar hiçbir ofiste etkin olmaz."}
          </p>
        </div>
      </div>

      <fieldset disabled={!canEdit || pending} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <FormField label="Pilot ofisler (plan ve yüzdeden bağımsız açık)" htmlFor={`${id}-ofis`}>
            <Combobox
              id={`${id}-ofis`}
              options={options}
              value={pick}
              onValueChange={addTenant}
              onSearch={async (q) => {
                const res = await searchTenantsBroadcast(q);
                setOptions(res);
                return res;
              }}
              placeholder="Ofis ekle (adıyla arayın)"
              searchPlaceholder="Ofis adı…"
              emptyText="Ofis bulunamadı"
            />
          </FormField>
          {tenants.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Seçili pilot ofisler">
              {tenants.map((t) => (
                <li key={t.id} className="inline-flex min-h-8 touch:min-h-11 items-center gap-1 rounded-full border border-line bg-canvas pl-3 pr-1 text-xs font-semibold text-ink-950">
                  {t.name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${t.name} ofisini çıkar`}
                    className="h-6 w-6 rounded-full"
                    onClick={() => setTenants((prev) => prev.filter((x) => x.id !== t.id))}
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Plan süzgeci (boş: tüm planlar)</legend>
          <div className="flex flex-wrap gap-2">
            {planOptions.map((p) => (
              <FilterChip
                key={p.value}
                active={plans.includes(p.value)}
                onClick={() => setPlans((prev) => (prev.includes(p.value) ? prev.filter((x) => x !== p.value) : [...prev, p.value]))}
              >
                {p.label}
              </FilterChip>
            ))}
          </div>
        </fieldset>

        <FormField label="Yüzde (%)" htmlFor={`${id}-yuzde`} hint="Plan süzgecine uyan ofislerin yüzdesi; aynı ofis hep aynı sonucu alır">
          <FormInput
            id={`${id}-yuzde`}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={percentage}
            onChange={(e) => setPercentage(e.target.value)}
          />
        </FormField>
        <FormField label="Not (isteğe bağlı)" htmlFor={`${id}-not`}>
          <FormInput id={`${id}-not`} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. pilot: İstanbul ofisleri" />
        </FormField>
        <FormField label="Başlangıç" htmlFor={`${id}-bas`} hint="Boş: hemen (Türkiye saati)">
          <FormInput id={`${id}-bas`} type="datetime-local" value={startsLocal} onChange={(e) => setStartsLocal(e.target.value)} />
        </FormField>
        <FormField label="Bitiş" htmlFor={`${id}-bit`} hint="Boş: kaldırılana kadar; bitişte kurala uyan ofislerde de kapanır">
          <FormInput id={`${id}-bit`} type="datetime-local" value={endsLocal} onChange={(e) => setEndsLocal(e.target.value)} />
        </FormField>
        <FormField label="Gerekçe" htmlFor={`${id}-gerekce`} required hint="En az 10 karakter; denetim izine yazılır" className="sm:col-span-2">
          <FormTextarea id={`${id}-gerekce`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </fieldset>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="navy" size="md" disabled={pending}>
            {pending ? "Kaydediliyor…" : "Hedeflemeyi kaydet"}
          </Button>
          {init ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={pending}
              onClick={() => run(() => deleteFeatureFlagRule({ flagKey, reason }), "Hedefleme kaldırıldı: genel anahtar herkese uygulanır.")}
            >
              Hedeflemeyi kaldır
            </Button>
          ) : null}
          {error ? <span role="alert" className="text-sm font-semibold text-danger-600">{error}</span> : null}
          {done ? <span role="status" className="text-sm font-semibold text-mint-600">{done}</span> : null}
        </div>
      ) : (
        <p className="text-xs text-text-muted">Değiştirmek için süper admin yetkisi gerekir.</p>
      )}
    </form>
  );
}
