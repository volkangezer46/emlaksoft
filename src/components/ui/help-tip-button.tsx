"use client";

import Link from "@/components/ui/smart-link";
import { useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * HelpTip'in istemci yarısı (açılır/kapanır düğme). Sözlük içeriği (`help-content.ts`, ~30 KB) istemci
 * paketine GİRMEZ: sunucu sarmalayıcı (`help-tip.tsx`) terimi çözer, burası yalnız hazır metni alır.
 */
export function HelpTipButton({
  text,
  name,
  moreHref,
  className,
}: {
  text: ReactNode;
  /** Ekran okuyucu adı. */
  name: string;
  /** "Daha fazla" bağlantısı (sözlük girdisi varsa). */
  moreHref?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

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
          {moreHref ? (
            <>
              {" "}
              <Link
                href={moreHref}
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
