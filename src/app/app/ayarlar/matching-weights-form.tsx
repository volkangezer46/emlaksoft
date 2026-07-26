"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, Save } from "lucide-react";
import { updateMatchingWeights } from "@/app/actions/settings";
import {
  DEFAULT_MATCHING_WEIGHTS,
  MATCHING_WEIGHT_KEYS,
  MATCHING_WEIGHT_LABELS,
  matchingWeightsPercent,
  type MatchingWeights,
} from "@/lib/matching";

const CRITERIA_DESC: Record<keyof MatchingWeights, string> = {
  budget: "Talep bütçesi ile liste fiyatı örtüşmesi",
  location: "İl + ilçe eşleşmesi",
  rooms: "Oda sayısı (3+1 vb.)",
  type: "Portföy türü (daire, arsa...)",
  sqm: "Minimum metrekare şartı",
};

/** Varsayılan setin %100'e normalize edilmiş hali (form başlangıcı). */
const DEFAULT_PERCENT = matchingWeightsPercent(DEFAULT_MATCHING_WEIGHTS);

export function MatchingWeightsForm({ initial }: { initial: MatchingWeights | null }) {
  const [values, setValues] = useState<MatchingWeights>(() => ({
    ...(initial ?? DEFAULT_PERCENT),
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const total = useMemo(
    () => MATCHING_WEIGHT_KEYS.reduce((s, k) => s + (Number.isFinite(values[k]) ? values[k] : 0), 0),
    [values],
  );

  function setValue(key: keyof MatchingWeights, raw: string) {
    const n = Number(raw);
    setValues((prev) => ({ ...prev, [key]: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0 }));
  }

  async function submit(reset: boolean) {
    setPending(true);
    setError(null);
    setSaved(false);
    const fd = new FormData();
    if (reset) {
      fd.set("reset", "1");
    } else {
      for (const key of MATCHING_WEIGHT_KEYS) fd.set(key, String(values[key]));
    }
    const result = await updateMatchingWeights(fd);
    setPending(false);
    if (result.ok) {
      if (reset) setValues({ ...DEFAULT_PERCENT });
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
      return;
    }
    setError(result.error ?? "Kaydedilemedi.");
  }

  return (
    <form
      action={() => submit(false)}
      className="mt-5 space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {MATCHING_WEIGHT_KEYS.map((key) => (
          <div key={key} className="rounded-[14px] border border-line bg-canvas p-4">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`weight-${key}`} className="text-sm font-semibold text-ink-950">
                {MATCHING_WEIGHT_LABELS[key]}
              </label>
              <div className="flex items-center gap-1">
                <input
                  id={`weight-${key}`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={values[key]}
                  onChange={(e) => setValue(key, e.target.value)}
                  className="w-16 rounded-[8px] border border-line bg-surface px-2 py-1 text-right text-sm font-bold text-ink-950 outline-none transition focus:border-brand-400"
                />
                <span className="text-xs font-semibold text-text-muted">%</span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={values[key]}
              onChange={(e) => setValue(key, e.target.value)}
              aria-label={`${MATCHING_WEIGHT_LABELS[key]} ağırlığı`}
              className="mt-3 w-full accent-[var(--brand-600,#2563eb)]"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{CRITERIA_DESC[key]}</p>
          </div>
        ))}

        {/* Toplam göstergesi */}
        <div className={`flex flex-col justify-center rounded-[14px] border p-4 ${total === 100 ? "border-mint-500/30 bg-mint-500/8" : "border-amber-400/40 bg-amber-400/10"}`}>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted">Toplam</p>
          <p className={`font-display text-2xl font-extrabold ${total === 100 ? "text-mint-600" : "text-amber-600"}`}>
            %{total}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            {total === 100
              ? "Ağırlıklar dengeli — toplam %100."
              : `Toplam %100'den ${total > 100 ? "fazla" : "az"}; kayıtta oransal olarak %100'e normalize edilir.`}
          </p>
        </div>
      </div>

      <p className="text-xs text-text-muted">
        İşlem türü (satılık/kiralık) uyumu ağırlıklandırılmaz — sabit ön koşuldur; uyumsuz çiftler her zaman elenir.
      </p>

      {error ? <p className="text-sm text-danger-500" role="alert">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        {saved ? (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-mint-600">
            <Check className="h-4 w-4" /> Kaydedildi
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={pending}
          className="focus-ring press inline-flex items-center gap-2 rounded-[10px] border border-line bg-canvas px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:border-brand-300 disabled:opacity-60"
        >
          <RotateCcw className="h-4 w-4" /> Varsayılana dön
        </button>
        <button
          type="submit"
          disabled={pending}
          className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          <Save className="h-4 w-4" /> {pending ? "Kaydediliyor…" : "Ağırlıkları kaydet"}
        </button>
      </div>
    </form>
  );
}
