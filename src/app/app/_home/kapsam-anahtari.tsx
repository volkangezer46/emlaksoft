import Link from "next/link";
import { cn } from "@/lib/utils";

/** Ana ekran sorgu parametreleri (bağlantılar birbirinin durumunu korur). */
export type HomeParams = { donem?: string; kapsam?: string; daha?: string; icgoru?: string };

export function homeHref(params: HomeParams, patch: Partial<HomeParams>): string {
  const merged = { ...params, ...patch };
  const sp = new URLSearchParams();
  if (merged.donem) sp.set("donem", merged.donem);
  if (merged.kapsam) sp.set("kapsam", merged.kapsam);
  if (merged.daha) sp.set("daha", merged.daha);
  if (merged.icgoru) sp.set("icgoru", merged.icgoru);
  const qs = sp.toString();
  return qs ? `/app?${qs}` : "/app";
}

/**
 * Yönetim rolleri için kapsam anahtarı: varsayılan "Benim kayıtlarım" (assigned_to = ben),
 * "Ofis görünümü" (?kapsam=ofis) görev/randevu/müşteri/portföy sorgularını ofis geneline açar.
 */
export function KapsamAnahtari({ params, ofis }: { params: HomeParams; ofis: boolean }) {
  const tab = "focus-ring press inline-flex h-9 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold transition";
  return (
    <nav aria-label="Ana ekran kapsamı" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-text-muted">Görünüm</span>
      <Link
        href={homeHref(params, { kapsam: undefined })}
        aria-current={ofis ? undefined : "page"}
        className={cn(tab, !ofis ? "bg-brand-600 text-white" : "border border-line bg-surface text-ink-950 hover:bg-canvas")}
      >
        Benim kayıtlarım
      </Link>
      <Link
        href={homeHref(params, { kapsam: "ofis" })}
        aria-current={ofis ? "page" : undefined}
        className={cn(tab, ofis ? "bg-brand-600 text-white" : "border border-line bg-surface text-ink-950 hover:bg-canvas")}
      >
        Ofis görünümü
      </Link>
    </nav>
  );
}
