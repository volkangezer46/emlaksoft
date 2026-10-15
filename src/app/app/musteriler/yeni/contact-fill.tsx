"use client";

import { useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ContactPickButton, useContactPickerSupported } from "@/components/app/contact-pick-button";
import type { PickedContact } from "@/lib/vcard-import";

/**
 * Yeni müşteri formu: "Rehberden seç" (Android Chrome). Seçilen TEK kişinin adı, telefonu ve e-postası forma yazılır;
 * alanlar kullanıcı yazmış gibi `input` olayıyla güncellenir → telefon biçimlenir, mükerrer uyarısı (DuplicateHint,
 * telefonla) ve taslak/özet anında çalışır. Destek yoksa hiçbir şey çizilmez.
 */

/** Türk cep numarasını öne alır (05…, +905…, 5XX…); yoksa ilk numara. */
export function preferredPhone(tels: readonly string[] | undefined): string {
  const list = (tels ?? []).map((t) => t.trim()).filter(Boolean);
  const mobile = list.find((t) => /^(\+?90|0)?5\d{9}$/.test(t.replace(/[\s().-]/g, "")));
  return mobile ?? list[0] ?? "";
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function ContactFill({ phoneInputId }: { phoneInputId: string }) {
  const supported = useContactPickerSupported();
  const ref = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState("");
  if (!supported) return null;

  const apply = (contacts: PickedContact[]) => {
    const c = contacts[0];
    const form = ref.current?.closest("form");
    if (!c || !form) return;
    const name = (c.name?.find((n) => n.trim()) ?? "").trim();
    const phone = preferredPhone(c.tel);
    const email = (c.email?.find((e) => e.trim()) ?? "").trim();
    const nameEl = form.elements.namedItem("full_name");
    if (name && nameEl instanceof HTMLInputElement) setNativeValue(nameEl, name);
    const phoneEl = form.querySelector<HTMLInputElement>(`#${CSS.escape(phoneInputId)}`);
    if (phone && phoneEl) setNativeValue(phoneEl, phone);
    const emailEl = form.querySelector<HTMLInputElement>('input[name="email"]:not([type="hidden"])');
    if (email && emailEl) setNativeValue(emailEl, email);
    setFilled([name, phone].filter(Boolean).join(" · ") || "Seçilen kişi");
  };

  return (
    <div ref={ref} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3 sm:col-span-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <p className="text-xs text-text-muted">
        Kişi telefon rehberinizdeyse bilgilerini yazmadan getirin. Yalnız seçtiğiniz kişi okunur.
      </p>
      <ContactPickButton onPick={apply} size="sm" className="shrink-0" />
      {filled ? (
        <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-mint-600 sm:basis-full">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Rehberden dolduruldu: {filled}. Aynı numara ofiste kayıtlıysa uyarı gösterilir.
        </p>
      ) : null}
    </div>
  );
}
