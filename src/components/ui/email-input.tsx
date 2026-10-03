"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { fieldClass } from "@/components/ui/form-controls";

type EmailInputProps = Omit<ComponentProps<"input">, "type" | "inputMode" | "ref">;

/**
 * E-posta alanı: type=email, odaklı klavye, otomatik büyük harf/yazım denetimi kapalı.
 * Odak çıkınca kırpar + küçük harfe çevirir (kontrollü kullanımda onChange tetiklenir).
 * Geçersiz değer `Geçerli bir e-posta adresi girin` ile form gönderimini engeller.
 * `className` verilirse `fieldClass` yerine kullanılır (mevcut görünümü korumak için).
 */
export function EmailInput({
  className,
  autoComplete = "email",
  onBlur,
  onChange,
  "aria-invalid": ariaInvalid,
  ...rest
}: EmailInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  const [invalid, setInvalid] = useState(false);

  function validate(el: HTMLInputElement) {
    const bad = el.value.trim() !== "" && !isValidEmail(el.value);
    el.setCustomValidity(bad ? EMAIL_ERROR_MESSAGE : "");
    setInvalid(bad);
  }

  // Dış değer değişimi (kontrollü) veya ilk render sonrası doğrulamayı güncel tut.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bad = el.value.trim() !== "" && !isValidEmail(el.value);
    el.setCustomValidity(bad ? EMAIL_ERROR_MESSAGE : "");
    setInvalid(bad);
  }, [rest.value]);

  return (
    <input
      {...rest}
      ref={ref}
      type="email"
      inputMode="email"
      autoComplete={autoComplete}
      autoCapitalize="none"
      spellCheck={false}
      aria-invalid={ariaInvalid || (touched && invalid) || undefined}
      className={className ?? fieldClass}
      onChange={(event) => {
        validate(event.currentTarget);
        onChange?.(event);
      }}
      onBlur={(event) => {
        const el = event.currentTarget;
        const normalized = normalizeEmail(el.value);
        if (normalized !== el.value) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(el, normalized);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        validate(el);
        setTouched(true);
        onBlur?.(event);
      }}
    />
  );
}
