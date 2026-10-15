import { Bus, Building, Footprints, GraduationCap, HeartPulse, Landmark, MapPinned, School, ShoppingBasket, ShoppingBag, TrainFront, Trees, Waves, type LucideIcon } from "lucide-react";
import { formatDistance, groupNearby, walkingMinutes, type NearbyCategory, type NearbyPlace } from "@/lib/vitrin/nearby";

const ICONS: Record<NearbyCategory, LucideIcon> = {
  okul: School,
  universite: GraduationCap,
  metro: TrainFront,
  otobus: Bus,
  hastane: HeartPulse,
  market: ShoppingBasket,
  avm: ShoppingBag,
  park: Trees,
  cami: Landmark,
  sahil: Waves,
  diger: Building,
};

/**
 * "Çevrede neler var" (PUB-8): danışmanın girdiği yakın noktalar, kategori başına en yakın 3 yer. Sunucu bileşeni
 * (istemci JS yok). Mesafe kuş uçuşudur; yürüme süresi yaklaşık. Liste boşsa bölüm hiç çizilmez (boş vaat yok).
 */
export function NearbyPanel({ places }: { places: readonly NearbyPlace[] }) {
  const groups = groupNearby(places);
  if (!groups.length) return null;
  return (
    <section className="mt-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5" aria-labelledby="cevre-baslik">
      <h2 id="cevre-baslik" className="flex items-center gap-2 font-display text-base font-extrabold text-ink-950">
        <MapPinned className="h-4 w-4 text-brand-600" aria-hidden="true" /> Çevrede neler var
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {groups.map((g) => {
          const Icon = ICONS[g.category] ?? Building;
          return (
            <li key={g.category} className="rounded-[var(--radius-card)] border border-line bg-canvas p-3.5">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600/10 text-brand-600" aria-hidden="true">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {g.label}
              </p>
              <ul className="mt-2 space-y-1.5">
                {g.items.slice(0, 3).map((p, i) => {
                  const walk = walkingMinutes(p.m);
                  return (
                    <li key={`${p.n}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 break-words font-semibold text-ink-950">{p.n}</span>
                      <span className="shrink-0 text-right text-xs text-text-muted">
                        {formatDistance(p.m)}
                        {walk != null ? (
                          <span className="ml-1.5 inline-flex items-center gap-0.5">
                            · <Footprints className="h-3 w-3" aria-hidden="true" /> {walk} dk
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-text-faint">Mesafeler kuş uçuşu ve yaklaşıktır; ofis tarafından girilmiştir.</p>
    </section>
  );
}
