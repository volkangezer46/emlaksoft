"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { FormValues } from "@/lib/form-tabs";

/** Formdaki seçili alanların güncel (string) değerleri; dosya alanları atlanır. */
export function readFormValues(form: HTMLFormElement, names: readonly string[]): FormValues {
  const data = new FormData(form);
  const out: FormValues = {};
  for (const name of names) {
    const v = data.get(name);
    if (typeof v === "string") out[name] = v;
  }
  return out;
}

function sameValues(a: FormValues, b: FormValues): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/**
 * Özet paneli için canlı değerler. Kontrolsüz alanlar kontrolsüz kalır: form üzerindeki
 * input/change/click/keyup/focusout olaylarını dinler, requestAnimationFrame ile
 * birleştirip `FormData`'dan okur (rAF: React'in kontrollü alanlarının — PhoneInput,
 * Combobox gizli input'ları — değeri yazmasından SONRA okumak için). Değer
 * değişmediyse yeniden render yok.
 */
export function useFormValues(formRef: RefObject<HTMLFormElement | null>, names: readonly string[]): FormValues {
  const [values, setValues] = useState<FormValues>({});
  const key = names.join("|");

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const list = key ? key.split("|") : [];
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = readFormValues(form, list);
      setValues((prev) => (sameValues(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(read);
    };
    const events = ["input", "change", "click", "keyup", "focusout"] as const;
    for (const e of events) form.addEventListener(e, schedule);
    schedule(); // ilk okuma (tarayıcının geri yüklediği değerler dahil)
    return () => {
      for (const e of events) form.removeEventListener(e, schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [formRef, key]);

  return values;
}
