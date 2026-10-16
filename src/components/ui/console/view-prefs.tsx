"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveFontScale } from "@/app/actions/font-scale";
import { applyFontScale, DEFAULT_FONT_SCALE, FONT_SCALES, isFontScale, readAppliedFontScale, type FontScale } from "@/lib/font-scale";
import { cn } from "@/lib/utils";
import { writeUiPrefsCookie, type UiPrefs } from "@/lib/ui-prefs";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

/**
 * Kullanıcı menüsü görünüm tercihleri — Radix menü öğeleri (B171): ok tuşlarıyla tüm denetimlere ulaşılır
 * (eski role=switch düğmesi ve Kaydet/Vazgeç'li radyo grubu menünün roving focus'una girmiyordu).
 * Seçim menüyü kapatmaz (`preventDefault`), etkisi anında görünür.
 */

/**
 * "Sade görünüm" (açık: az menü, büyük düğmeler; kapalı: "Tüm özellikleri göster"). Hiçbir özellik silinmez, sade modda
 * katlanır. Değer `SimpleModeProvider` üzerinden tüm sayfalara gider (`useSimpleMode`).
 * Ofis+kullanıcı kapsamlı çereze yazılır, sunucu çıktısı yenilenir (menü SSR'da uygulanır). */
export function ViewPrefs({ cookieName, initial }: { cookieName: string; initial: UiPrefs }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [pending, startTransition] = useTransition();

  const toggle = (simple: boolean) => {
    const next = { ...prefs, simple };
    setPrefs(next);
    writeUiPrefsCookie(cookieName, next);
    startTransition(() => router.refresh());
  };

  return (
    <DropdownMenuCheckboxItem
      checked={prefs.simple}
      onCheckedChange={(v) => toggle(v === true)}
      onSelect={(e) => e.preventDefault()}
      aria-busy={pending}
    >
      <span className="min-w-0">
        <span className="block font-semibold">Sade görünüm</span>
        <span className="block text-xs text-text-muted">{prefs.simple ? "Dengeli: önemli bilgi açık, ayrıntı katlı" : "Tüm özellikler gösteriliyor"}</span>
      </span>
    </DropdownMenuCheckboxItem>
  );
}

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
