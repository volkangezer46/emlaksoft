import { formatTry } from "@/lib/format";
import type { ReactNode } from "react";
import { MapPinned, Sparkles } from "lucide-react";
import type { createClient } from "@/lib/supabase/server";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { getProvinceOptions } from "@/lib/geo/reader";
import { loadRegions, loadSpecialties, loadSpecialtyOptions } from "@/lib/advisor/advisor-store";
import { SPECIALTY_LEVELS, type RegionView, type SpecialtyView } from "@/lib/advisor/advisor-profile";
import { RegionsEditor, SpecialtiesEditor } from "./profil-editors";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function Section({ id, title, count, icon, children }: { id: string; title: string; count: number; icon: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-950">
        {icon} {title}
        <a href={`#${id}`} className="focus-ring ml-auto rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-600/20" aria-label={`${title}: ${count} kayıt`}>
          {count}
        </a>
      </h2>
      {children}
    </section>
  );
}

function priceBand(r: SpecialtyView): string | null {
  if (r.price_min === null && r.price_max === null) return null;
  if (r.price_min !== null && r.price_max !== null) return `${formatTry(r.price_min)} - ${formatTry(r.price_max)}`;
  return r.price_min !== null ? `${formatTry(r.price_min)} ve üzeri` : `${formatTry(r.price_max ?? 0)} ve altı`;
}

function SpecialtyList({ rows }: { rows: SpecialtyView[] }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-text-muted">Uzmanlık tanımlanmamış.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 text-sm">
          <span className="font-semibold text-ink-950">{r.value}</span>
          <span className="text-xs text-text-muted">
            {[r.kind === "segment" ? "Segment" : "Tür", r.transaction_type ?? "Satılık ve kiralık", SPECIALTY_LEVELS.find((l) => l.value === r.level)?.label, priceBand(r), r.experience_years !== null ? `${r.experience_years} yıl` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RegionList({ rows }: { rows: RegionView[] }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-text-muted">Bölge tanımlanmamış.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 text-sm">
          <span className="font-semibold text-ink-950">
            {[r.province_name, r.district_name, r.neighborhood_name].filter(Boolean).join(" › ") || "Bölge"}
          </span>
          <span className="text-xs text-text-muted">Ağırlık {r.weight}/5</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Uzmanlık ve bölgeler" sekmesi: ofis sahibi / GM düzenler, diğerleri salt okunur görür (uzmanlık ofis içinde
 * herkese açık "ekip vitrini" verisidir). Şema yoksa çağıran sekmeyi gizler; burada da zarif boş durum vardır.
 */
export async function SpecialtyTab({
  supabase,
  tenantId,
  memberId,
  viewerRole,
}: {
  supabase: Supabase;
  tenantId: string;
  memberId: string;
  viewerRole: string;
}) {
  const canManage = viewerRole === "owner" || viewerRole === "gm";
  const [specs, regions, options, provinces] = await Promise.all([
    loadSpecialties(supabase, tenantId, memberId),
    loadRegions(supabase, tenantId, memberId),
    canManage ? loadSpecialtyOptions() : Promise.resolve({ propertyTypes: [], segments: [] }),
    canManage ? getProvinceOptions() : Promise.resolve([]),
  ]);

  if (!specs.available || !regions.available) {
    return (
      <EmptyStateV3
        title="Uzmanlık ve bölgeler bu ortamda henüz etkin değil"
        description="Uzmanlık ve bölge tanımları veritabanı güncellemesi uygulandığında açılır."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Section id="uzmanliklar" title="Uzmanlık" count={specs.data.length} icon={<Sparkles className="h-4 w-4 text-brand-600" />}>
        {canManage ? (
          <SpecialtiesEditor profileId={memberId} options={options} defaults={specs.data} />
        ) : (
          <SpecialtyList rows={specs.data} />
        )}
      </Section>
      <Section id="bolgeler" title="Bölgeler" count={regions.data.length} icon={<MapPinned className="h-4 w-4 text-mint-600" />}>
        {canManage ? (
          <RegionsEditor profileId={memberId} provinces={provinces} defaults={regions.data} />
        ) : (
          <RegionList rows={regions.data} />
        )}
      </Section>
    </div>
  );
}
