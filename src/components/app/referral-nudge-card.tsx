"use client";

import { useSyncExternalStore } from "react";
import Link from "@/components/ui/smart-link";
import { HeartHandshake, X } from "lucide-react";
import { NUDGE_COPY, nudgeStorageKey, type NudgeMoment } from "@/lib/growth/program";

/**
 * Davet kartı (kapatılabilir). Metin sabit tutar içermez; ödül ayrıntısı /app/buyume'dedir.
 * Kapatma tercihi yalnız bu tarayıcıda (localStorage) tutulur; erişilemezse kart görünmeye devam eder.
 */
function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener("emlaksoft:nudge", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("emlaksoft:nudge", onChange);
  };
}

export function ReferralNudgeCard({ moment }: { moment: NudgeMoment }) {
  const key = nudgeStorageKey(moment);
  // Sunucuda kapalı sayılır (kart SSR'da çizilir, kapatılmışsa istemcide gizlenir).
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(key),
    () => false,
  );
  if (dismissed) return null;
  const copy = NUDGE_COPY[moment];
  return (
    <aside
      aria-label="Davet önerisi"
      className="flex items-start gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface p-3 shadow-[var(--elev-1)]"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-brand-600">
        <HeartHandshake className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-950">{copy.title}</p>
        <p className="mt-0.5 text-xs text-text-muted">{copy.text}</p>
        <Link
          href="/app/buyume"
          className="focus-ring press mt-2 inline-flex min-h-[36px] items-center rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
        >
          {copy.cta}
        </Link>
      </div>
      <button
        type="button"
        aria-label="Bu öneriyi kapat"
        className="focus-ring rounded-full p-1.5 text-text-muted transition hover:bg-canvas"
        onClick={() => {
          try {
            window.localStorage.setItem(key, "1");
          } catch {
            /* depolama yok: kart bu oturumda kalır */
          }
          window.dispatchEvent(new Event("emlaksoft:nudge"));
        }}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  );
}
