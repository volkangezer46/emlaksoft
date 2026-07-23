"use client";

import { useState } from "react";
import { formatTurkishPhone, sanitizeTurkishPhoneInput, TR_MOBILE_PLACEHOLDER } from "@/lib/phone";

type UncontrolledProps = {
  defaultValue?: string | null;
  value?: undefined;
  onValueChange?: undefined;
};

type ControlledProps = {
  defaultValue?: undefined;
  value: string;
  onValueChange: (digits: string) => void;
};

type PhoneInputProps = (UncontrolledProps | ControlledProps) & {
  id?: string;
  name?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
};

/**
 * Türk cep telefonu maskeli input. Ekranda "05XX XXX XX XX" boşluklu gösterir.
 * Kontrolsüz kullanımda form'a gönderilen `name` değeri ham `05XXXXXXXXX` (11 hane) olur.
 * Kontrollü kullanımda (`value`/`onValueChange`) dışarıya ham rakamlar bildirilir.
 */
export function PhoneInput(props: PhoneInputProps) {
  const { id, name, required, className, placeholder = TR_MOBILE_PLACEHOLDER } = props;
  const isControlled = props.value !== undefined;

  const [uncontrolledDisplay, setUncontrolledDisplay] = useState(() =>
    formatTurkishPhone(isControlled ? "" : props.defaultValue ?? ""),
  );

  const display = isControlled ? formatTurkishPhone(props.value) : uncontrolledDisplay;

  const inputClassName =
    className ??
    "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";

  return (
    <input
      id={id}
      name={name}
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      required={required}
      value={display}
      onChange={(event) => {
        const digits = sanitizeTurkishPhoneInput(event.target.value);
        if (isControlled) {
          props.onValueChange(digits);
        } else {
          setUncontrolledDisplay(formatTurkishPhone(digits));
        }
      }}
      placeholder={placeholder}
      className={inputClassName}
    />
  );
}
