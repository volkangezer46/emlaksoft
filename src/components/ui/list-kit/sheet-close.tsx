"use client";

import { X } from "lucide-react";

/**
 * Filtre alt sayfasının (ListToolbar `<details>`) kapat düğmesi — yalnız dar ekranda görünür.
 * Sayfa JS'siz de çalışır (zemine dokunmak `summary`'e düşer ve kapatır); bu düğme açık bir kapatma eylemi verir.
 */
export function SheetClose() {
  return (
    <button
      type="button"
      onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
      aria-label="Filtreleri kapat"
      className="focus-ring press grid size-11 touch:size-11 place-items-center rounded-[var(--radius-control)] text-text-muted transition hover:bg-surface-hover hover:text-text"
    >
      <X aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}
