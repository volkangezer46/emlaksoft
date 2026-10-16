"use client";

import { useState, useTransition } from "react";
import { saveFontScale } from "@/app/actions/font-scale";
import { applyFontScale, DEFAULT_FONT_SCALE, FONT_SCALES, isFontScale, readAppliedFontScale, type FontScale } from "@/lib/font-scale";
import { cn } from "@/lib/utils";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

/**
 * Kullanıcı menüsü yazı boyutu tercihi — Radix menü öğeleri (B171): ok tuşlarıyla tüm denetimlere ulaşılır
 * (eski role=switch düğmesi ve Kaydet/Vazgeç'li radyo grubu menünün roving focus'una girmiyordu).
 * Seçim menüyü kapatmaz (`preventDefault`), etkisi anında görünür.
 */

/**
 * Yazı boyutu (Küçük / Normal / Büyük): seçim ANINDA uygulanır ve kaydedilir (Kaydet/Vazgeç yok). Kayıt düşerse önceki
 * kayıtlı değere dönülür ve neden menüde yazılır.
 */
export function FontScaleMenuItems({ initial }: { initial: FontScale }) {
  const [scale, setScale] = useState<FontScale>(() => readAppliedFontScale() ?? initial ?? DEFAULT_FONT_SCALE);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const choose = (raw: string) => {
    if (!isFontScale(raw) || raw === scale) return;
    const prev = scale;
    setScale(raw);
    setError("");
    applyFontScale(raw);
    startTransition(async () => {
      const result = await saveFontScale(raw);
      if (!result.ok) {
        setScale(prev);
        applyFontScale(prev);
        setError(result.error);
      }
    });
  };

  return (
    <>
      <DropdownMenuLabel>Yazı boyutu</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={scale} onValueChange={choose} aria-label="Yazı boyutu" aria-busy={pending}>
        {FONT_SCALES.map((f) => (
          <DropdownMenuRadioItem key={f.value} value={f.value} onSelect={(e) => e.preventDefault()}>
            {f.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <p role="status" aria-live="polite" className={cn("px-3 text-xs", error ? "py-1 text-danger-500" : "sr-only")}>
        {error}
      </p>
    </>
  );
}
