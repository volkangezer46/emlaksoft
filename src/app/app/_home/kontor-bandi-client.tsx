"use client";

import Link from "@/components/ui/smart-link";
import { useSyncExternalStore, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

/** Kapatma durumu tarayıcıda (kullanıcı + durum başına); okunamazsa band görünür kalır. */
function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function KontorBandiKutu({
  storageKey,
  empty,
  href,
  actionLabel,
  children,
}: {
  storageKey: string;
  empty: boolean;
  href: string;
  actionLabel: string;
  children: ReactNode;
}) {
  const dismissed = useSyncExternalStore(subscribe, () => read(storageKey), () => false);
  if (dismissed) return null;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border px-4 py-2.5 text-sm text-ink-950 ${
        empty ? "border-danger-500/40 bg-danger-500/10" : "border-amber-400/40 bg-amber-400/10"
      }`}
    >
      <AlertTriangle className={`h-4 w-4 shrink-0 ${empty ? "text-danger-600" : "text-amber-600"}`} aria-hidden />
      <span>{children}</span>
      <Link href={href} className="focus-ring ml-auto text-xs font-bold underline underline-offset-2">
        {actionLabel}
      </Link>
      <button
        type="button"
        aria-label="Kontör uyarısını kapat"
        onClick={() => {
          try {
            window.localStorage.setItem(storageKey, "1");
          } catch {
            /* kapatma kalıcı olmayabilir */
          }
          listeners.forEach((l) => l());
        }}
        className="focus-ring press grid h-7 w-7 place-items-center rounded-full text-text-muted hover:bg-ink-950/6"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
