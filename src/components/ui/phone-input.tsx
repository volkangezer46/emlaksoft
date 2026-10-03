"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  capNational,
  formatTurkishPhone,
  groupNationalDigits,
  interpretPhoneEntry,
  parsePhone,
  PHONE_ERROR_MESSAGE,
  TR_MOBILE_PLACEHOLDER,
} from "@/lib/phone";
import {
  DEFAULT_PHONE_COUNTRY,
  getPhoneCountry,
  matchPhoneCountry,
  PHONE_COUNTRIES,
} from "@/lib/phone-countries";

type UncontrolledProps = {
  defaultValue?: string | null;
  value?: undefined;
  onValueChange?: undefined;
};

type ControlledProps = {
  defaultValue?: undefined;
  /** Saklama biçimi: 05XXXXXXXXX (Türkiye) veya +<E.164> (yabancı). */
  value: string;
  onValueChange: (stored: string) => void;
};

type PhoneInputProps = (UncontrolledProps | ControlledProps) & {
  id?: string;
  name?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
  autoComplete?: string;
  /** Başlangıç/boşken seçili ülke (ISO, varsayılan TR). */
  defaultCountry?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

type Entry = { country: string; digits: string };

/** Saklama biçiminden (veya eski ham rakamlardan) ülke + ulusal rakamları çıkarır. */
function fromStored(value: string | null | undefined, fallbackCountry: string): Entry {
  const v = (value ?? "").trim();
  if (!v) return { country: fallbackCountry, digits: "" };
  if (v.startsWith("+")) {
    const c = matchPhoneCountry(v.replace(/\D/g, ""));
    if (c) return { country: c.iso, digits: capNational(c.iso, v.replace(/\D/g, "").slice(c.dial.length)) };
    return { country: fallbackCountry, digits: "" };
  }
  return { country: "TR", digits: capNational("TR", v) };
}

/** Form'a gidecek değer: TR -> 0'lı rakamlar (eskisi gibi), yabancı -> +<kod><rakamlar>. */
function toStoredValue(entry: Entry): string {
  if (!entry.digits) return "";
  if (entry.country === "TR") return entry.digits;
  const c = getPhoneCountry(entry.country);
  return `+${c?.dial ?? ""}${entry.digits}`;
}

function displayDigits(entry: Entry): string {
  return entry.country === "TR" ? formatTurkishPhone(entry.digits) : groupNationalDigits(entry.digits);
}

const DEFAULT_INPUT_CLASS =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400 aria-[invalid=true]:border-danger-400";

/**
 * Uluslararası telefon girişi (varsayılan Türkiye). Solda ülke seçici (bayrak + +kod), sağda ulusal numara.
 *
 * - Yalnız rakam girilebilir; yapıştırmada temizlenir; +90 / 0090 / +49 yapıştırılırsa ülke otomatik seçilir.
 * - Form'a giden `name` değeri SAKLAMA BİÇİMİdir: Türkiye 05XXXXXXXXX (veya sabit 0XXXXXXXXXX), yabancı +<E.164>.
 *   (Gizli input taşır; görünür alan adsızdır.)
 * - Kontrollü kullanımda (`value`/`onValueChange`) aynı saklama biçimi gidip gelir.
 * - Geçersiz/yarım numara tarayıcı doğrulamasında `Geçerli bir telefon numarası girin` ile engellenir.
 */
export function PhoneInput(props: PhoneInputProps) {
  const {
    id,
    name,
    required,
    className,
    placeholder,
    autoComplete = "tel",
    defaultCountry = DEFAULT_PHONE_COUNTRY,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
  } = props;
  const isControlled = props.value !== undefined;

  const [uncontrolled, setUncontrolled] = useState<Entry>(() =>
    fromStored(isControlled ? "" : props.defaultValue, defaultCountry),
  );
  // Kontrollü kullanımda değer boşken seçili ülkeyi hatırlamak için.
  const [emptyCountry, setEmptyCountry] = useState(defaultCountry);
  // '+4' gibi henüz tamamlanmamış ülke kodu taslağı.
  const [draft, setDraft] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const entry: Entry = isControlled
    ? fromStored(props.value, emptyCountry)
    : uncontrolled;

  const stored = toStoredValue(entry);
  const incomplete = draft !== null && draft !== "";
  const invalid = incomplete || (stored !== "" && !parsePhone(stored).ok);

  useEffect(() => {
    inputRef.current?.setCustomValidity(invalid ? PHONE_ERROR_MESSAGE : "");
  }, [invalid]);

  function commit(next: Entry) {
    if (isControlled) {
      if (!next.digits) setEmptyCountry(next.country);
      props.onValueChange(toStoredValue(next));
    } else {
      setUncontrolled(next);
    }
  }

  const shown = draft !== null ? `+${draft}` : displayDigits(entry);
  const country = getPhoneCountry(entry.country) ?? PHONE_COUNTRIES[0];
  const isTr = entry.country === "TR";
  const effectivePlaceholder = isTr ? (placeholder ?? TR_MOBILE_PLACEHOLDER) : country.example;
  const showError = touched && invalid;
  const hintId = `${useId()}-phone-err`;
  const describedByIds = [ariaDescribedBy, showError ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  const inputClassName = `${className ?? DEFAULT_INPUT_CLASS} min-w-0 flex-1${
    showError ? " border-danger-500! ring-1 ring-danger-500/25" : ""
  }`;

  return (
    <div>
    <div className="flex items-stretch gap-2">
      <label
        className="relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm text-ink transition focus-within:border-brand-400"
      >
        <span
          aria-hidden="true"
          className="rounded-[var(--radius-control)] bg-line/60 px-1.5 py-0.5 text-xs font-semibold leading-none tracking-wide text-ink"
        >
          {country.iso}
        </span>
        <span className="tabular-nums">+{country.dial}</span>
        <span aria-hidden="true" className="text-xs text-muted">
          ▾
        </span>
        <select
          aria-label="Ülke kodu"
          value={entry.country}
          onChange={(event) => {
            setDraft(null);
            commit({ country: event.target.value, digits: capNational(event.target.value, entry.digits) });
            inputRef.current?.focus();
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.iso} · {c.ad} (+{c.dial})
            </option>
          ))}
        </select>
      </label>
      <input
        ref={inputRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        aria-describedby={describedByIds}
        aria-invalid={ariaInvalid || (touched && invalid) || undefined}
        required={required}
        value={shown}
        onChange={(event) => {
          const next = interpretPhoneEntry(event.target.value, entry.country);
          setDraft(next.pending);
          if (next.pending !== null) return;
          commit({ country: next.country, digits: next.digits });
        }}
        onBlur={() => setTouched(true)}
        placeholder={effectivePlaceholder}
        className={inputClassName}
      />
      {name ? <input type="hidden" name={name} value={stored} /> : null}
    </div>
    {showError ? (
      <p id={hintId} className="mt-1 text-xs font-medium text-danger-strong">
        {PHONE_ERROR_MESSAGE}
      </p>
    ) : null}
    </div>
  );
}
