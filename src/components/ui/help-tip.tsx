"use client";

import Link from "@/components/ui/smart-link";
import { useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { glossaryEntry } from "@/lib/help-content";
import { cn } from "@/lib/utils";

/**
 * HelpTip: terimin yanındaki "?" düğmesi. Tooltip ya da popup DEĞİL; basınca
 * metnin hemen altında kısa bir açıklama satır içi açılır, tekrar basınca kapanır.
 *
 * - Klavye: Enter/Boşluk açar, Esc kapatır; `aria-expanded` + `aria-controls`.
 * - Dokunma hedefi 44x44 px (görünen yuvarlak 20 px; negatif kenar boşluğu
 *   satır yüksekliğini bozmaz).
 * - `topic`: yardım sözlüğündeki anahtar (src/lib/help-content.ts). Açıklama ve
 *   "Daha fazla" bağlantısı (/app/yardim?sekme=sozluk#konu) oradan gelir.
 *   `children` verilirse sözlük metninin yerine geçer.
 */
export function HelpTip({
  topic,
  children,
  label,
  className,
}: {
  topic: string;
  children?: ReactNode;
  /** Ekran okuyucu adı; verilmezse terim adı kullanılır. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const entry = glossaryEntry(topic);
  const text = children ?? entry?.short;
  if (!text) return null;
  const name = label ?? entry?.term ?? "Yardım";

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <span className={cn("inline", className)} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${name}: açıklamayı ${open ? "kapat" : "göster"}`}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring group -my-3 ml-0.5 inline-grid h-11 w-11 shrink-0 place-items-center rounded-full align-middle"
      >
        <span
          aria-hidden
          className={cn(
            "grid h-5 w-5 place-items-center rounded-full border text-xs font-bold leading-none transition",
            open
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-line bg-surface text-text-muted group-hover:border-brand-300 group-hover:text-brand-600",
          )}
        >
          ?
        </span>
      </button>
      {open ? (
        <span
          id={panelId}
          role="note"
          className="mt-2 block max-w-prose rounded-[var(--radius-control)] border border-brand-300/60 bg-brand-600/[0.05] px-3 py-2.5 text-sm font-normal normal-case leading-relaxed tracking-normal text-text"
        >
          {text}
          {entry ? (
            <>
              {" "}
              <Link
                href={`/app/yardim?sekme=sozluk#${entry.slug}`}
                className="focus-ring inline-flex min-h-11 items-center font-semibold text-brand-600 underline-offset-2 hover:underline"
              >
                Daha fazla
              </Link>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
