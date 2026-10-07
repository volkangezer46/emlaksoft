"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Switch — erişilebilir aç/kapa (role="switch"). Server Action formlarıyla
 * uyumlu: `name` verilirse ve açıksa formda `name=on` gönderilir (checkbox
 * semantiği). Kontrollü (`checked`) ya da kontrolsüz (`defaultChecked`) kullanılır.
 */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  name,
  disabled,
  id,
  className,
  ...aria
}: {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (next: boolean) => void;
  name?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const [inner, setInner] = useState(defaultChecked);
  const on = checked ?? inner;

  return (
    <>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={on}
        disabled={disabled}
        onClick={() => {
          const next = !on;
          if (checked === undefined) setInner(next);
          onCheckedChange?.(next);
        }}
        className={cn(
          "focus-ring relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          // Dokunmatikte görünüm aynı, basma alanı 44px: görünmez genişletme katmanı.
          "touch:before:absolute touch:before:-inset-y-2.5 touch:before:inset-x-0",
          on ? "bg-accent" : "bg-line-strong",
          className,
        )}
        {...aria}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none h-5 w-5 rounded-full bg-white shadow-[var(--elev-1)] transition-transform",
            on ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
      {name && on ? <input type="hidden" name={name} value="on" /> : null}
    </>
  );
}
