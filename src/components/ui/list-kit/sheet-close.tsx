"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Filtre alt sayfasının (ListToolbar `<details>`) kapat düğmesi — yalnız dar ekranda görünür.
 * Sayfa JS'siz de çalışır (zemine dokunmak `summary`'e düşer ve kapatır); bu düğme açık bir kapatma eylemi verir.
 * JS ile ayrıca: açıkken Escape sayfayı kapatır ve odak "Filtreler" düğmesine döner (masaüstü açılır panelde de).
 */
export function SheetClose() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const details = ref.current?.closest("details");
    if (!details) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !details.open) return;
      details.removeAttribute("open");
      details.querySelector("summary")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
      aria-label="Filtreleri kapat"
      className="focus-ring press grid size-11 touch:size-11 place-items-center rounded-[var(--radius-control)] text-text-muted transition hover:bg-surface-hover hover:text-text"
    >
      <X aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}

/**
 * Panel formu gönderilirken arama kutusundaki GÜNCEL metni taşır. Arama ve panel iki ayrı GET formu: panel aramayı
 * URL'deki eski değerden gizli alanla taşır (JS'siz yol); kullanıcı aramaya yazıp göndermeden "Filtreleri uygula"ya
 * basarsa yazdığı metin kaybolmasın diye `formdata` anında kardeş arama formundaki değer yazılır.
 */
export function PanelSearchCarry({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    const search = form?.closest("details")?.parentElement?.querySelector<HTMLInputElement>(`form[role="search"] input[name="${CSS.escape(name)}"]`);
    if (!form || !search) return;
    const onFormData = (e: FormDataEvent) => {
      const v = search.value.trim();
      if (v) e.formData.set(name, v);
      else e.formData.delete(name);
    };
    form.addEventListener("formdata", onFormData);
    return () => form.removeEventListener("formdata", onFormData);
  }, [name]);
  return <span ref={ref} hidden />;
}
