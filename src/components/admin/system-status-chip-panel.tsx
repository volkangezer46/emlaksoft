"use client";

import Link from "@/components/ui/smart-link";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AdminHealth } from "@/lib/admin-badges";
import { formatTrTime } from "@/lib/clock";
import { systemStatusOf } from "@/lib/admin/system-status";
import { SystemStatusButton } from "@/components/admin/system-status-chip";

/** Sistem durumu Popover gövdesi — system-status-chip.tsx tarafından ilk etkileşimde yüklenir ve açık gelir. */
export function SystemStatusChipPanel({ health, clock = "", initialOpen }: { health: AdminHealth; clock?: string; initialOpen?: boolean }) {
  const s = systemStatusOf(health);
  const dot = s.level === "ok" ? "bg-mint-500 status-pulse" : s.level === "warn" ? "bg-amber-500" : "bg-danger-500";
  const tone = s.level === "ok" ? "bg-mint-500/10 text-mint-700" : s.level === "warn" ? "bg-amber-500/12 text-amber-800" : "bg-danger-500/12 text-danger-600";
  return (
    <Popover defaultOpen={initialOpen}>
      <PopoverTrigger asChild>
        <SystemStatusButton health={health} clock={clock} />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4 text-sm">
        <p className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.1em] text-text-muted">Sistem durumu</span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
            {s.label}
          </span>
        </p>
        <dl className="mt-3 space-y-1.5">
          <div className="flex justify-between gap-2">
            <dt className="text-text-muted">Veritabanı</dt>
            <dd className="num font-semibold text-ink-950">{health.ok ? `${health.dbMs} ms` : "Sorgu hata verdi"}</dd>
          </div>
          {health.cronTotal != null ? (
            <div className="flex justify-between gap-2">
              <dt className="text-text-muted">Zamanlanmış işler</dt>
              <dd className="num font-semibold text-ink-950">
                {health.cronTotal - (health.cronErrors ?? 0)} / {health.cronTotal} başarılı
              </dd>
            </div>
          ) : null}
          {health.checkedAt ? (
            <div className="flex justify-between gap-2">
              <dt className="text-text-muted">Son kontrol</dt>
              <dd className="num font-semibold text-ink-950">{formatTrTime(health.checkedAt)}</dd>
            </div>
          ) : null}
        </dl>
        {health.failedJobs && health.failedJobs.length > 0 ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-[var(--radius-control)] bg-amber-500/10 px-2.5 py-2 text-xs font-semibold text-amber-800">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="break-words">Hatalı iş: {health.failedJobs.join(", ")}</span>
          </p>
        ) : null}
        <Link
          href="/admin/sistem"
          className="focus-ring mt-3 flex min-h-9 items-center justify-between rounded-[var(--radius-control)] border border-line px-3 text-sm font-semibold text-ink-950 transition hover:bg-canvas touch:min-h-11"
        >
          Sistemi görüntüle
          <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" aria-hidden />
        </Link>
      </PopoverContent>
    </Popover>
  );
}
