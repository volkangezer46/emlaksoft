"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { cleanLabel, fieldDisplay, type FieldKind } from "@/lib/form-summary";

/** Özet satırı için bir alanın DOM'dan çözülmüş etiketi ve gösterim metni. */
export type FieldInfo = { label: string | null; text: string | null };

function labelFor(form: HTMLFormElement, el: Element): string | null {
  const id = el.id;
  if (id) {
    const l = form.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (l) return cleanLabel(l.textContent);
  }
  const wrapping = el.closest("label");
  if (wrapping) return cleanLabel(wrapping.textContent);
  return cleanLabel(el.getAttribute("aria-label"));
}

/** Combobox: gizli input'un kardeşi `button[role=combobox]` (görünen etiket + erişilebilir ad). */
function comboTrigger(el: Element): HTMLButtonElement | null {
  let n = el.nextElementSibling;
  while (n) {
    if (n instanceof HTMLButtonElement && n.getAttribute("role") === "combobox") return n;
    n = n.nextElementSibling;
  }
  return null;
}

function readField(form: HTMLFormElement, name: string): FieldInfo | null {
  const els = Array.from(form.querySelectorAll(`[name="${CSS.escape(name)}"]`));
  if (els.length === 0) return null;
  const first = els[0];
  const data = new FormData(form).get(name);
  const raw = typeof data === "string" ? data : null;

  if (first instanceof HTMLInputElement && first.type === "radio") {
    const checked = els.find((e): e is HTMLInputElement => e instanceof HTMLInputElement && e.checked);
    const lbl = checked ? labelFor(form, checked) : null;
    const group = first.closest("fieldset")?.querySelector("legend")?.textContent;
    return { label: cleanLabel(group), text: fieldDisplay(name, { kind: "radio", raw, selectedLabel: lbl }) };
  }
  if (first instanceof HTMLInputElement && first.type === "checkbox") {
    return { label: labelFor(form, first), text: fieldDisplay(name, { kind: "checkbox", raw, checked: first.checked }) };
  }
  if (first instanceof HTMLInputElement && first.type === "file") return null;

  const secret = first instanceof HTMLInputElement && first.type === "password";
  let kind: FieldKind = "text";
  let selectedLabel: string | null = null;
  let label = labelFor(form, first);
  if (first instanceof HTMLSelectElement) {
    kind = "select";
    selectedLabel = first.selectedOptions[0]?.textContent ?? null;
  } else if (first instanceof HTMLInputElement && first.type === "hidden") {
    const trigger = comboTrigger(first);
    if (trigger) {
      kind = "select";
      selectedLabel = trigger.textContent;
      label = labelFor(form, trigger) ?? label;
    }
  }
  return { label, text: fieldDisplay(name, { kind, raw, selectedLabel, secret }) };
}

function same(a: Record<string, FieldInfo>, b: Record<string, FieldInfo>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => b[k] && a[k].label === b[k].label && a[k].text === b[k].text);
}

/**
 * Sekme alanlarının görünen etiketi ve metni (telefon biçimli, il/ilçe/mahalle etiketli).
 * Olay + MutationObserver (Combobox seçimi portal'da olur, form olayı üretmez) -> rAF ile birleşik okuma.
 * DOM'da bulunmayan alan sonuçta yoktur.
 */
export function useFormFields(formRef: RefObject<HTMLFormElement | null>, names: readonly string[]): Record<string, FieldInfo> {
  const [info, setInfo] = useState<Record<string, FieldInfo>>({});
  const key = names.join("|");

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const list = key ? key.split("|") : [];
    let frame = 0;
    const read = () => {
      frame = 0;
      const next: Record<string, FieldInfo> = {};
      for (const n of list) {
        const f = readField(form, n);
        if (f) next[n] = f;
      }
      setInfo((prev) => (same(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const events = ["input", "change", "click", "keyup", "focusout"] as const;
    for (const e of events) form.addEventListener(e, schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(form, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["value", "checked", "disabled"] });
    schedule();
    return () => {
      for (const e of events) form.removeEventListener(e, schedule);
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [formRef, key]);

  return info;
}
