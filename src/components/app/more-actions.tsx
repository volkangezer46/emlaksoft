"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hero eylem satırında ikincil eylemleri mobilde "Daha fazla" ardına katlar.
 * Masaüstünde (md+) çocuklar ebeveyn flex satırına olduğu gibi katılır (`contents`),
 * yani yerleşim değişmez. Çocuklar her zaman DOM'da kalır; yalnız mobilde gizlenir/açılır
 * (içlerindeki diyalog tetikleyicileri ve formlar çalışmaya devam eder).
 * Erişilebilirlik: düğme aria-expanded + aria-controls, klavye ile Enter/Boşluk.
 */
export function MoreActions({
  children,
  label = "Daha fazla",
  tone = "dark",
}: {
  children: ReactNode;
  label?: string;
  /** dark: koyu hero üstü; light: açık zemin. */
  tone?: "dark" | "light";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          "focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-3.5 py-2 text-sm font-semibold transition md:hidden",
          tone === "dark"
            ? "border-white/15 bg-white/5 text-white hover:bg-white/10"
            : "border-line bg-surface text-text hover:bg-surface-2",
        )}
      >
        {open ? "Daha az" : label}
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={id} className={cn(open ? "flex w-full flex-wrap gap-2" : "hidden", "md:contents")}>
        {children}
      </div>
    </>
  );
}
