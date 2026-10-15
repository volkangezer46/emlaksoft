"use client";

import { useState } from "react";
import { now } from "@/lib/clock";
import { DUE_PRESETS, DUE_PRESET_LABELS, duePresetLocal, type DuePreset } from "@/lib/due-presets";
import { cn } from "@/lib/utils";

/**
 * GA-04 hazır vade çipleri: "Bugün 18:00 · Yarın 10:00 · Pazartesi 10:00 · +1 hafta". Tarih alanının altında durur;
 * dokununca alan Türkiye saatiyle dolar (`onPick("YYYY-MM-DDTHH:mm")`). "Bugün 18:00" geçtiyse gösterilmez.
 * `baseLocal`: "+1 hafta" mevcut değerden yürür (yoksa bugünden 7 gün sonra 10:00). Dokunma hedefi mobilde ≥44 px.
 */
export function DueQuickPicks({
  onPick,
  baseLocal,
  presets = DUE_PRESETS,
  className,
  label = "Hızlı seçim",
}: {
  onPick: (local: string) => void;
  baseLocal?: string | null;
  presets?: readonly DuePreset[];
  className?: string;
  label?: string;
}) {
  // Görünür seçenekler ilk çizimde bir kez hesaplanır (render saflığı); seçim anında saat yeniden okunur.
  const [visible] = useState(() => {
    const t = now();
    return presets.filter((p) => duePresetLocal(p, t) != null);
  });
  const baseMs = baseLocal ? Date.parse(`${baseLocal}:00+03:00`) : null;
  return (
    <div role="group" aria-label={label} className={cn("mt-1.5 flex flex-wrap gap-1.5", className)}>
      {visible.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => {
            const v = duePresetLocal(p, now(), Number.isFinite(baseMs) ? baseMs : null);
            if (v) onPick(v);
          }}
          className="focus-ring press inline-flex min-h-8 items-center rounded-full border border-line bg-canvas px-2.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-700 touch:min-h-11 touch:px-3.5"
        >
          {DUE_PRESET_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

/** Kontrolsüz `<input>`'a değer yazar ve React'e bildirir (form özet sekmeleri değişikliği görsün). */
export function setNativeInputValue(input: HTMLInputElement | null, value: string): void {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
