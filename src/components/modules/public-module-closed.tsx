import { PowerOff } from "lucide-react";
import { MODULE_CLOSED_PUBLIC_MESSAGE } from "@/lib/modules/registry";

/**
 * Ofisin kapattığı bir özelliğe ait herkese açık bağlantının gösterdiği sayfa.
 * Veri dönmez, arama motoruna indekslenmez (noindex), her zaman açık temadadır.
 */
export function PublicModuleClosed({ officeName }: { officeName?: string | null }) {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <meta name="robots" content="noindex,nofollow" />
      <div className="w-full max-w-md rounded-[var(--radius-panel)] border border-line bg-surface p-8 text-center shadow-[var(--shadow-xs)]">
        <span aria-hidden className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ink-950/8 text-text-muted">
          <PowerOff className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-display text-lg font-bold text-ink-950">Bu bağlantı şu an kullanılamıyor</h1>
        <p className="mt-2 text-sm text-text-muted">{MODULE_CLOSED_PUBLIC_MESSAGE}</p>
        {officeName ? <p className="mt-3 text-xs text-text-faint">{officeName}</p> : null}
      </div>
    </main>
  );
}
