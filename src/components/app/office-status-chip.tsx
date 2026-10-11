"use client";

import { Suspense, type ComponentProps } from "react";
import { ChevronUp } from "lucide-react";
import type { PlanUsageRow } from "@/lib/nav-badges";
import { officeStatusOf } from "@/lib/app-shell/office-status";
import { useDeferredPanel } from "@/hooks/use-deferred-panel";
import { lazyPanel } from "@/lib/lazy-panel";

export type OfficeStatusChipProps = {
  officeName: string;
  plan: string;
  trial: boolean;
  trialDaysLeft: number | null;
  usage: readonly PlanUsageRow[];
  canUpgrade: boolean;
  onNavigate?: () => void;
};

/** Çip düğmesi: hafif kabukta ve Radix gövdesinde AYNI görünüm (React 19: `ref` prop'u `asChild` ile geçer). */
export function OfficeStatusButton({
  officeName,
  plan,
  trial,
  trialDaysLeft,
  usage,
  ...rest
}: Pick<OfficeStatusChipProps, "officeName" | "plan" | "trial" | "trialDaysLeft" | "usage"> & ComponentProps<"button">) {
  const s = officeStatusOf({ trial, trialDaysLeft, usage });
  const dot = s.level === "ok" ? "bg-mint-400" : s.level === "warn" ? "bg-amber-400" : "bg-danger-400";
  const bar = s.level === "ok" ? "bg-mint-400" : s.level === "warn" ? "bg-amber-400" : "bg-danger-400";
  return (
    <button
      type="button"
      aria-label={`Ofis durumu: ${plan}${s.short ? `, ${s.short}` : ""}${s.detail ? `, ${s.detail}` : ""}. Ayrıntıyı aç`}
      title={`${officeName} · ${plan}`}
      className="sb-row focus-ring group flex min-h-9 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-left text-white/85 transition-colors hover:bg-white/8 hover:text-white touch:min-h-11"
      {...rest}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="sb-label min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate font-semibold">{plan}</span>
          {s.short ? <span className="num shrink-0 text-xs font-semibold text-white/70">{s.short}</span> : null}
        </span>
        {s.detail ? <span className="num mt-0.5 block truncate text-xs text-white/65">{s.detail}</span> : null}
        {s.ratio != null ? (
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <span className={`block h-full rounded-full ${bar}`} style={{ width: `${Math.max(s.ratio * 100, 3)}%` }} />
          </span>
        ) : null}
      </span>
      <ChevronUp className="sb-label h-3.5 w-3.5 shrink-0 text-white/50 group-hover:text-white/80" aria-hidden />
    </button>
  );
}

// Radix Popover gövdesi ilk etkileşime kadar yüklenmez; kabuk açıldıktan sonra boşta önceden iner.
const panel = lazyPanel(() => import("@/components/app/office-status-chip-panel").then((m) => m.OfficeStatusChipPanel));

/**
 * Yan menü altındaki kompakt OFİS DURUMU çipi (admin `SystemStatusChip` ile aynı dil). Eski büyük kartın yerine
 * tek satır: renkli nokta + paket adı + kısa durum (deneme kalan gün ya da en dolu kullanım yüzdesi) + ince çubuk.
 * Daraltılmış menüde yalnız nokta. Tıklayınca küçük panel: paket, kullanım kalemleri (her biri ilgili listeye
 * gider), "Paketi yönet". Tüm değerler mevcut kabuk verisinden (plan, trial_ends_at, plan kullanımı); sahte sayı yok.
 *
 * Hafif kabuk: Radix Popover gövdesi (`office-status-chip-panel.tsx`) ilk etkileşimde yüklenir ve açık gelir.
 */
export function OfficeStatusChip(props: OfficeStatusChipProps) {
  const { Panel, open, warm } = useDeferredPanel(panel);
  const { officeName, plan, trial, trialDaysLeft, usage } = props;
  const button = (
    <OfficeStatusButton
      officeName={officeName}
      plan={plan}
      trial={trial}
      trialDaysLeft={trialDaysLeft}
      usage={usage}
      onClick={open}
      onPointerEnter={warm}
      onFocus={warm}
      aria-haspopup="dialog"
      aria-expanded={false}
    />
  );
  if (!Panel) return button;
  return (
    <Suspense fallback={button}>
      <Panel {...props} initialOpen />
    </Suspense>
  );
}
