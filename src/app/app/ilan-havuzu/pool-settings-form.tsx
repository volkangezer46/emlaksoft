"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { saveListingPoolSettings } from "@/app/actions/listing-pool";
import { useToast } from "@/components/app/toast-provider";
import { POOL_MODES, type PoolMode } from "@/lib/pool/modes";

const FIELD =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400";

/** Havuz ayarı (yalnız owner/gm): aç/kapat, atama modu, asgari puan, SLA / sahiplenme süresi. */
export function PoolSettingsForm({
  enabled,
  mode,
  minScore,
  slaMinutes,
}: {
  enabled: boolean;
  mode: PoolMode;
  minScore: number | null;
  slaMinutes: number | null;
}) {
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<PoolMode>(mode);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await saveListingPoolSettings(fd);
          if (res.ok) push("Havuz ayarları kaydedildi.", "ok");
          else push(res.error ?? "Kaydedilemedi.", "err");
        });
      }}
      className="space-y-4"
    >
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="enabled" value="1" defaultChecked={enabled} className="mt-1 h-4 w-4" />
        <span>
          <span className="font-semibold text-ink-950">İlan havuzunu aç</span>
          <span className="block text-xs text-text-muted">
            Açıkken atanmamış, içe aktarılmış, portal ve ağ kaynaklı ilanlar önce havuza düşer. Kendi adına ilan ekleyen danışman havuza
            düşmez.
          </span>
        </span>
      </label>

      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-ink-950">Atama modu</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {POOL_MODES.map((m) => (
            <label
              key={m.value}
              className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border p-3 text-sm transition ${selected === m.value ? "border-brand-400 bg-brand-50" : "border-line bg-surface"}`}
            >
              <input
                type="radio"
                name="mode"
                value={m.value}
                checked={selected === m.value}
                onChange={() => setSelected(m.value)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold text-ink-950">{m.label}</span>
                <span className="block text-xs text-text-muted">{m.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-ink-950">
          Asgari puan (otomatik mod)
          <input name="min_score" inputMode="numeric" defaultValue={minScore ?? ""} placeholder="Örn. 60" disabled={selected !== "auto"} className={`${FIELD} mt-1 disabled:opacity-50`} />
        </label>
        <label className="text-xs font-semibold text-ink-950">
          SLA / sahiplenme süresi (dakika)
          <input name="sla_minutes" inputMode="numeric" defaultValue={slaMinutes ?? ""} placeholder="Örn. 30" className={`${FIELD} mt-1`} />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-ink-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-50"
      >
        <Save className="h-4 w-4" /> {pending ? "Kaydediliyor…" : "Ayarları kaydet"}
      </button>
    </form>
  );
}
