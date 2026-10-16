"use client";

import { Suspense, type ComponentProps } from "react";
import type { AdminHealth } from "@/lib/admin-badges";
import { systemStatusOf } from "@/lib/admin/system-status";
import { useDeferredPanel } from "@/hooks/use-deferred-panel";
import { lazyPanel } from "@/lib/lazy-panel";

/** Çip düğmesi: hafif kabukta ve Radix gövdesinde AYNI görünüm (React 19: `ref` prop'u `asChild` ile geçer). */
export function SystemStatusButton({ health, clock = "", ...rest }: { health: AdminHealth; clock?: string } & ComponentProps<"button">) {
  const s = systemStatusOf(health);
  const dot = s.level === "ok" ? "bg-mint-500 status-pulse" : s.level === "warn" ? "bg-amber-500" : "bg-danger-500";
  return (
    <button
      type="button"
      className="focus-ring inline-flex h-11 items-center gap-2 rounded-full border border-hairline bg-surface-raised px-3.5 text-sm font-semibold text-text shadow-[var(--elev-1)] transition-colors hover:border-border-interactive"
      aria-label={`Sistem durumu: ${s.label}. Ayrıntıyı aç`}
      title={`Sistem durumu: ${s.label}`}
      {...rest}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span aria-live="polite" className="hidden max-w-[11rem] truncate min-[1600px]:inline">{s.label}</span>
      {clock ? (
        <span className="hidden border-l border-hairline pl-2 tabular-nums text-text-muted lg:inline" aria-label={`Saat ${clock}`}>
          {clock}
        </span>
      ) : null}
    </button>
  );
}

// Radix Popover gövdesi ilk etkileşime kadar yüklenmez; kabuk açıldıktan sonra boşta önceden iner.
const panel = lazyPanel(() => import("@/components/admin/system-status-chip-panel").then((m) => m.SystemStatusChipPanel));

/**
 * Üst çubuktaki kompakt sistem durumu çipi (yan menüdeki büyük kart yerine). Tek satır: renkli nokta + kısa durum;
 * tıklayınca/klavyeyle (Enter, Space; Escape kapatır) ayrıntı paneli açılır. Değerler gerçek ölçümden
 * (`getAdminHealth`, 30 sn önbellek); uydurma kesintisiz süre yok. Durum metni `aria-live="polite"`.
 * Hafif kabuk: Radix Popover gövdesi (`system-status-chip-panel.tsx`) ilk etkileşimde yüklenir ve açık gelir.
 */
export function SystemStatusChip({ health, clock = "" }: { health: AdminHealth; clock?: string }) {
  const { Panel, open, warm } = useDeferredPanel(panel);
  const button = (
    <SystemStatusButton health={health} clock={clock} onClick={open} onPointerEnter={warm} onFocus={warm} aria-haspopup="dialog" aria-expanded={false} />
  );
  if (!Panel) return button;
  return (
    <Suspense fallback={button}>
      <Panel health={health} clock={clock} initialOpen />
    </Suspense>
  );
}
