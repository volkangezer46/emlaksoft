"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Hareketler klavye kısayolları: "/" arama kutusuna odaklanır, J / K görünür satırlar arasında gezer, Enter odaktaki
 * satırı düzenler (satırın birincil düzenleme düğmesi ya da ilk satır içi alan). Yazı alanındayken, açık diyalogda ya da
 * Ctrl/⌘/Alt basılıyken kısayollar devre dışıdır (genel palet Ctrl/⌘K ile çakışmaz).
 */

/** Kısayolun yutulmaması gereken hedef: yazı alanları ve düzenlenebilir içerik. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable;
}

/** Saf: geçerli indeks + tuş -> yeni indeks (sınırda durur; seçim yokken J ilk, K son satıra gider). */
export function nextRowIndex(current: number, count: number, key: "j" | "k"): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return key === "j" ? 0 : count - 1;
  return key === "j" ? Math.min(count - 1, current + 1) : Math.max(0, current - 1);
}

export function LedgerKeyboardNav({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function rows(): HTMLElement[] {
      const root = ref.current;
      if (!root) return [];
      // Masaüstü tablo ya da mobil kart: yalnız görünür olan dizi gezilir.
      return [...root.querySelectorAll<HTMLElement>("[data-ledger-row]")].filter((r) => r.offsetParent !== null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog']")) return;
      const root = ref.current;
      if (!root) return;
      const key = e.key.toLowerCase();
      if (e.key === "/") {
        const search = root.querySelector<HTMLInputElement>("input[type='search']");
        if (!search) return;
        e.preventDefault();
        search.focus();
        search.select();
        return;
      }
      if (key === "j" || key === "k") {
        const list = rows();
        if (list.length === 0) return;
        e.preventDefault();
        const current = list.findIndex((r) => r === document.activeElement || r.contains(document.activeElement));
        const next = list[nextRowIndex(current, list.length, key)];
        if (!next) return;
        for (const r of list) r.removeAttribute("data-kb-active");
        next.setAttribute("data-kb-active", "");
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter") {
        const row = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-ledger-row]");
        if (!row || row !== document.activeElement || !root.contains(row)) return;
        const primary = row.querySelector<HTMLElement>("[data-row-primary]:not([disabled])");
        const inline = row.querySelector<HTMLElement>("[data-inline-edit]:not([disabled])");
        const target = primary ?? inline;
        if (!target) return;
        e.preventDefault();
        if (primary) primary.click();
        else target.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={ref} className="grid gap-4">
      {children}
    </div>
  );
}
