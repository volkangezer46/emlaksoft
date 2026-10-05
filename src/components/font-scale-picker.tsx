"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { saveFontScale } from "@/app/actions/font-scale";
import {
  applyFontScale,
  DEFAULT_FONT_SCALE,
  FONT_SCALES,
  fontScaleLabel,
  readAppliedFontScale,
  type FontScale,
} from "@/lib/font-scale";
import { cn } from "@/lib/utils";

/**
 * "Yazı boyutu" seçici (Küçük / Normal / Büyük). Seçim anında ÖNİZLENİR (html[data-font-size]),
 * KALICI olarak yalnız Kaydet ile saklanır; Vazgeç kayıtlı değere döner. Panel kapanırken
 * kaydedilmemiş önizleme de kayıtlıya döner. Radio group: ok tuşları seçimi (ve önizlemeyi) değiştirir.
 */
export function FontScalePicker({ initial, className }: { initial?: FontScale; className?: string }) {
  const [saved, setSaved] = useState<FontScale>(() => readAppliedFontScale() ?? initial ?? DEFAULT_FONT_SCALE);
  const [draft, setDraft] = useState<FontScale>(saved);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const savedRef = useRef(saved);
  const groupRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const dirty = draft !== saved;

  // Kapanırken (söküm) kaydedilmemiş önizlemeyi geri al.
  useEffect(() => () => applyFontScale(savedRef.current), []);

  const preview = (next: FontScale) => {
    setDraft(next);
    setMessage("");
    applyFontScale(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back) return;
    e.preventDefault();
    e.stopPropagation(); // menü içinde: ok tuşları satır gezintisine gitmesin
    const i = FONT_SCALES.findIndex((f) => f.value === draft);
    const next = FONT_SCALES[(i + (forward ? 1 : FONT_SCALES.length - 1)) % FONT_SCALES.length]!.value;
    preview(next);
    groupRef.current?.querySelector<HTMLElement>(`[data-scale="${next}"]`)?.focus();
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveFontScale(draft);
      if (result.ok) {
        savedRef.current = result.scale;
        setSaved(result.scale);
        setFailed(false);
        setMessage(`Yazı boyutu kaydedildi: ${fontScaleLabel(result.scale)}`);
      } else {
        setFailed(true);
        setMessage(result.error);
      }
    });
  };

  const cancel = () => {
    setDraft(saved);
    setFailed(false);
    setMessage("");
    applyFontScale(saved);
  };

  return (
    <div className={cn("space-y-2", className)} aria-busy={pending}>
      <p id={labelId} className="text-sm font-semibold text-ink-950">
        Yazı boyutu
      </p>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] bg-surface-sunken p-1"
      >
        {FONT_SCALES.map((f) => {
          const active = draft === f.value;
          return (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              data-scale={f.value}
              onClick={() => preview(f.value)}
              className={cn(
                "focus-ring min-h-11 rounded-[var(--radius-chip)] px-1 text-xs font-medium transition-colors",
                active ? "bg-surface text-text shadow-[var(--elev-1)]" : "text-text-muted hover:text-text",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="focus-ring inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-accent-fg transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={!dirty || pending}
          className="focus-ring inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
        >
          Vazgeç
        </button>
      </div>
      <p role="status" aria-live="polite" className={cn("min-h-4 text-xs", failed ? "text-danger-500" : "text-text-muted")}>
        {message || (dirty ? "Önizleme: kalıcı olması için Kaydet'e basın." : "")}
      </p>
    </div>
  );
}
