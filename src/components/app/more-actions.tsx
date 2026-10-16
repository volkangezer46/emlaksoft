"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKitSimpleMode } from "@/components/ui/simple-kit";

/**
 * Hero eylem satırında ikincil eylemleri mobilde "Daha fazla" ardına katlar.
 * Masaüstünde (md+) çocuklar ebeveyn flex satırına olduğu gibi katılır (`contents`),
 * yani yerleşim değişmez. Çocuklar her zaman DOM'da kalır; yalnız mobilde gizlenir/açılır
 * (içlerindeki diyalog tetikleyicileri ve formlar çalışmaya devam eder).
 * Dengeli görünümde (varsayılan, /app) masaüstünde de katlıdır: hero satırında sık eylemler + "Daha fazla" kalır
 * (kayıt sayfasında 15-20 düğmelik duvar olmaz); tam görünümde masaüstünde satır içidir.
 * Erişilebilirlik: düğme aria-expanded + aria-controls, klavye ile Enter/Boşluk.
 */
export function MoreActions({
  children,
  label = "Daha fazla",
  tone = "dark",
  desktopInline = false,
}: {
  /** true: masaüstünde her modda satır içi (az sayıda ikincil eylem). */
  desktopInline?: boolean;
  children: ReactNode;
  label?: string;
  /** dark: koyu hero üstü; light: açık zemin. */
  tone?: "dark" | "light";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const kitSimple = useKitSimpleMode();
  const foldDesktop = kitSimple && !desktopInline;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          "focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-3.5 py-2 text-sm font-semibold transition touch:min-h-11",
          !foldDesktop && "md:hidden",
          tone === "dark"
            ? "border-white/15 bg-white/5 text-white hover:bg-white/10"
            : "border-line bg-surface text-text hover:bg-surface-2",
        )}
      >
        {open ? "Daha az" : label}
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={id} className={cn(open ? "flex w-full flex-wrap gap-2" : "hidden", !foldDesktop && "md:contents")}>
        {children}
      </div>
    </>
  );
}
