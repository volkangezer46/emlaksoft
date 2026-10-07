"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import type { PremiumTone } from "@/components/ui/premium/premium-math";

/**
 * InlineSelect — satır içi seçici (tablo hücresi): rozet/ikon görünümlü tetik + açılır liste.
 *
 * Radix Select üzerine kurulu: klavye (ok tuşları, Home/End, harfle arama, Esc), odak dönüşü, portal
 * (tablo `overflow` kabı listeyi kırpmaz), ekran okuyucu rolleri (combobox/listbox/option) hazır gelir.
 * Görünüm `kit.css` `.ins-*`; ton `pm-t-*` ailesinden (yeni ton sınıfı yazılmaz). `changed` verilirse tetiğin
 * köşesinde amber "değişti" noktası çizilir (satır içi kaydetme standardı). `name` verilirse Radix gizli native
 * `<select>` üretir → `<form action>` + FormData ile de çalışır.
 *
 * Seçenek ikonları istemci tarafında tanımlanmalıdır (fonksiyon sunucudan istemciye geçemez).
 */
export type InlineSelectOption = {
  value: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: PremiumTone;
  /** Liste satırında ikinci satır açıklama. */
  hint?: string;
  disabled?: boolean;
};

export function InlineSelect({
  value,
  onValueChange,
  options,
  label,
  disabled = false,
  changed = false,
  plain = false,
  name,
  className,
  contentLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly InlineSelectOption[];
  /** Erişilebilir ad ("Volkan Emlak durumu"). */
  label: string;
  disabled?: boolean;
  /** Kaydedilmemiş değişiklik işareti. */
  changed?: boolean;
  /** Tonsuz (beyaz) tetik — nötr seçimler için. */
  plain?: boolean;
  name?: string;
  className?: string;
  /** Liste başlığı (görsel değil, ekran okuyucu). */
  contentLabel?: string;
}) {
  const current = options.find((o) => o.value === value);
  const Icon = current?.icon;
  const tone = current?.tone ?? "neutral";
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled} name={name}>
      <SelectPrimitive.Trigger
        aria-label={changed ? `${label} (değişti, kaydedilmedi)` : label}
        data-changed={changed ? "1" : undefined}
        data-plain={plain ? "1" : undefined}
        className={cn("ins-trigger focus-ring", !plain && `pm-t-${tone}`, className)}
      >
        {Icon ? <Icon className="ins-ico" aria-hidden="true" /> : null}
        <span className="ins-label">
          <SelectPrimitive.Value>{current?.label ?? "Seçin"}</SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="ins-chev" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={6} collisionPadding={12} className="ins-content popover-in" aria-label={contentLabel ?? label}>
          <SelectPrimitive.Viewport>
            {options.map((o) => {
              const OIcon = o.icon;
              return (
                <SelectPrimitive.Item key={o.value} value={o.value} disabled={o.disabled} className={cn("ins-item", `pm-t-${o.tone ?? "neutral"}`)}>
                  {OIcon ? (
                    <span className="ins-dot" aria-hidden="true">
                      <OIcon />
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                    {o.hint ? <span className="ins-hint">{o.hint}</span> : null}
                  </span>
                  <SelectPrimitive.ItemIndicator>
                    <Check className="ins-check" aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
