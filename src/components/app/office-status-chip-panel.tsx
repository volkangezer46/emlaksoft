"use client";

import Link from "@/components/ui/smart-link";
import { ArrowUpRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usageRatio } from "@/lib/app-shell/office-status";
import { OfficeStatusButton, type OfficeStatusChipProps } from "@/components/app/office-status-chip";

/** Ofis durumu Popover gövdesi — office-status-chip.tsx tarafından ilk etkileşimde yüklenir ve açık gelir. */
export function OfficeStatusChipPanel({
  officeName,
  plan,
  trial,
  trialDaysLeft,
  usage,
  canUpgrade,
  onNavigate,
  initialOpen,
}: OfficeStatusChipProps & { initialOpen?: boolean }) {
  return (
    <Popover defaultOpen={initialOpen}>
      <PopoverTrigger asChild>
        <OfficeStatusButton officeName={officeName} plan={plan} trial={trial} trialDaysLeft={trialDaysLeft} usage={usage} />
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-72 p-4 text-sm">
        <p className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.1em] text-text-muted">Ofis durumu</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${
              trial ? "bg-amber-500/12 text-amber-800" : "bg-mint-500/10 text-mint-700"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${trial ? "bg-amber-500" : "bg-mint-500"}`} aria-hidden />
            {trial ? "Deneme" : plan}
          </span>
        </p>
        <p className="mt-2 truncate font-semibold text-ink-950" title={officeName}>{officeName}</p>
        {trial ? (
          <p className="mt-0.5 text-xs text-text-muted">
            {trialDaysLeft != null ? (trialDaysLeft > 0 ? `Denemenin bitmesine ${trialDaysLeft} gün` : "Deneme süresi doldu") : "Deneme sürümü"}
          </p>
        ) : null}
        {usage.length > 0 ? (
          <ul className="mt-3 space-y-2.5">
            {usage.map((u) => {
              const ratio = usageRatio(u);
              const tone = ratio >= 0.9 ? "bg-danger-500" : ratio >= 0.75 ? "bg-amber-500" : "bg-mint-500";
              return (
                <li key={u.key}>
                  <Link href={u.href} onClick={onNavigate} className="focus-ring group block rounded-[var(--radius-control)]">
                    <span className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-text-muted group-hover:text-ink-950">{u.label}</span>
                      <span className="num font-semibold text-ink-950">
                        {u.used.toLocaleString("tr-TR")} / {u.limit.toLocaleString("tr-TR")}
                      </span>
                    </span>
                    <span
                      className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-sunken"
                      role="meter"
                      aria-label={`${u.label} kullanımı`}
                      aria-valuemin={0}
                      aria-valuemax={u.limit}
                      aria-valuenow={Math.min(u.used, u.limit)}
                    >
                      <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(ratio * 100, u.used > 0 ? 3 : 0)}%` }} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-text-muted">Paketinizde sayılı kullanım sınırı yok.</p>
        )}
        <Link
          href="/app/abonelik"
          onClick={onNavigate}
          className="focus-ring mt-3 flex min-h-9 items-center justify-between rounded-[var(--radius-control)] border border-line px-3 text-sm font-semibold text-ink-950 transition hover:bg-canvas touch:min-h-11"
        >
          {canUpgrade || trial ? "Paketi yönet" : "Abonelik ve kullanım"}
          <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" aria-hidden />
        </Link>
      </PopoverContent>
    </Popover>
  );
}
