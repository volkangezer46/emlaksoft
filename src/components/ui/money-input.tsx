"use client";

import type { ClipboardEvent, ComponentProps, InputEvent } from "react";
import { cn } from "@/lib/utils";
import { fieldClass } from "@/components/ui/form-controls";
import { caretAfterFormat, formatMoneyTyping, formatMoneyValue, moneyTextToNumber, normalizeMoneyPaste } from "@/lib/money-typing";

type BaseProps = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange" | "min" | "step" | "max">;

export type MoneyInputProps = BaseProps & {
  /** Başlangıç tutarı (sayı ya da metin); "4.100.000" biçiminde gösterilir. */
  defaultValue?: number | string | null;
  /** Denetimli kullanım (ör. karşı teklif): alan metni ("4.800.000"). */
  value?: string;
  /** Her değişimde biçimli metin + çözülen sayı (boş/geçersiz → null). */
  onValueChange?: (text: string, amount: number | null) => void;
  /** Kuruş hanesi (varsayılan 2; tam sayı istenen alanlarda 0). */
  decimals?: number;
  /** Stil: varsayılan form alanı sınıfı; `bare` verilirse yalnız `className` kullanılır. */
  bare?: boolean;
};

const INVALID_HINT = "Geçerli bir tutar girin (ör. 4.500.000 ya da 1.250,50).";

/**
 * Türkçe tutar alanı (tek kaynak): `type="number"` yerine metin + ondalık klavye. Yazarken binlik ayraç eklenir, imleç
 * korunur, "1250.50" gibi yapıştırmalar tanınır. Form gönderimi biçimli metni taşır ("4.100.000"); sunucu `parseMoneyInput`
 * ile çözer. Tarayıcı `step` kısıtı yoktur (eski `step="1000" min="1"` yuvarlak tutarları reddediyordu).
 */
export function MoneyInput({ defaultValue, value, onValueChange, decimals = 2, bare, className, required, onInput, onPaste, ...rest }: MoneyInputProps) {
  function apply(el: HTMLInputElement, next: string, caret: number | null) {
    el.value = next;
    if (caret != null && document.activeElement === el) {
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* bazı tarayıcılar inputMode=decimal alanda seçim aralığı vermez */
      }
    }
    const amount = moneyTextToNumber(next);
    el.setCustomValidity(next && amount == null ? INVALID_HINT : "");
    onValueChange?.(next, amount);
  }

  function handleInput(e: InputEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const raw = el.value;
    const next = formatMoneyTyping(raw, decimals);
    apply(el, next, caretAfterFormat(raw, el.selectionStart ?? raw.length, next));
    onInput?.(e);
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    onPaste?.(e);
    if (e.defaultPrevented) return;
    const text = e.clipboardData.getData("text");
    const el = e.currentTarget;
    // Alan boşken (ya da tamamı seçiliyken) yapıştırılan tutar bütün olarak çözülür; aksi halde normal yazım kuralı işler.
    const whole = (el.selectionStart ?? 0) === 0 && (el.selectionEnd ?? 0) === el.value.length;
    if (!whole || !text) return;
    e.preventDefault();
    const next = normalizeMoneyPaste(text, decimals);
    apply(el, next, next.length);
  }

  const controlled = value !== undefined;
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      required={required}
      className={bare ? className : cn(fieldClass, "numeric", className)}
      {...(controlled ? { value, onChange: () => {} } : { defaultValue: formatMoneyValue(defaultValue ?? null, decimals) })}
      onInput={handleInput}
      onPaste={handlePaste}
    />
  );
}
