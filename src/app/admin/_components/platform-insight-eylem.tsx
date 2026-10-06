"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BellOff, ChevronDown, X } from "lucide-react";
import { setPlatformInsightState } from "@/app/actions/platform-insights";
import type { InsightDismissReason } from "@/lib/insights/types";

const SNOOZE: { label: string; days: number }[] = [
  { label: "Yarına", days: 1 },
  { label: "3 gün", days: 3 },
  { label: "1 hafta", days: 7 },
];
const DISMISS: { label: string; reason: InsightDismissReason }[] = [
  { label: "Yanlış öneri", reason: "yanlis" },
  { label: "Zaten yaptım", reason: "zaten_yaptim" },
  { label: "İlgisiz", reason: "ilgisiz" },
];

const btn =
  "focus-ring press inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-xs font-semibold text-ink-950 transition hover:bg-surface-hover [&::-webkit-details-marker]:hidden";

/** Platform içgörüsü eylemleri: Ertele ▾ / Yoksay ▾ (sunucu eylemi, RLS'li RPC). İçgörü kendi işini yapmaz. */
export function PlatformInsightEylem({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, form: HTMLDetailsElement | null) => {
    if (form) form.open = false;
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.error) setMsg(r.error);
      else router.refresh();
    });
  };

  const menu = (label: string, icon: React.ReactNode, items: { key: string; label: string; go: () => Promise<{ ok?: boolean; error?: string }> }[]) => (
    <details className="relative" aria-disabled={pending}>
      <summary className={`${btn} ${pending ? "pointer-events-none opacity-60" : ""}`} aria-haspopup="menu">
        {icon}
        {label}
        <ChevronDown className="h-3 w-3 text-text-muted" aria-hidden="true" />
      </summary>
      <ul role="menu" className="absolute left-0 top-full z-20 mt-1 min-w-36 rounded-[var(--radius-card)] border border-line bg-surface-raised p-1 shadow-[var(--elev-3)]">
        {items.map((it) => (
          <li key={it.key} role="none">
            <button
              type="button"
              role="menuitem"
              onClick={(e) => run(it.go, e.currentTarget.closest("details"))}
              className="focus-ring flex min-h-9 w-full items-center rounded-[var(--radius-control)] px-3 text-left text-sm font-medium text-ink-950 hover:bg-surface-hover"
            >
              {it.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {menu(
        "Ertele",
        <BellOff className="h-3.5 w-3.5" aria-hidden="true" />,
        SNOOZE.map((s) => ({ key: String(s.days), label: s.label, go: () => setPlatformInsightState(id, "snoozed", { snoozeDays: s.days }) })),
      )}
      {menu(
        "Yoksay",
        <X className="h-3.5 w-3.5" aria-hidden="true" />,
        DISMISS.map((d) => ({ key: d.reason, label: d.label, go: () => setPlatformInsightState(id, "dismissed", { reason: d.reason }) })),
      )}
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-[var(--pm-danger-text)]">
        {pending ? "İşleniyor…" : (msg ?? "")}
      </p>
    </div>
  );
}
