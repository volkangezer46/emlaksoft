import Link from "next/link";
import { Building2, CalendarDays, Layers, MapPin, BadgeCheck, Clock3, Grid3x3 } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listProjects } from "@/app/actions/projects";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { NewProjectDialog } from "./new-project-dialog";

export const metadata = { title: "Projeler" };

const STATUS_LABELS: Record<string, string> = {
  planning:  "Planlama",
  selling:   "Satışta",
  delivered: "Teslim edildi",
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  planning:  "info",
  selling:   "success",
  delivered: "default",
};

export default async function ProjelerPage() {
  const { perms } = await requireModulePage("projects");
  const canCreate = (perms.projects ?? []).includes("create");

  const projects = await listProjects();

  const allUnits   = projects.flatMap((p) => p.units);
  const aktifProje = projects.filter((p) => p.status !== "delivered").length;
  const satilan    = allUnits.filter((u) => u.status === "sold").length;
  const rezerve    = allUnits.filter((u) => u.status === "reserved" || u.status === "deposit").length;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Layers className="h-4 w-4" /> İnşaat proje satışı
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Projeler</h1>
            <p className="mt-1 text-sm text-white/75">
              Müteahhit projelerinin daire stoğunu, rezervasyon ve satışlarını tek ekrandan yönetin.
            </p>
          </div>
          {canCreate ? <NewProjectDialog /> : null}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Aktif proje" value={aktifProje} icon={Building2} />
        <StatCard label="Toplam stok" value={allUnits.length} icon={Grid3x3} />
        <StatCard label="Satılan" value={satilan} icon={BadgeCheck} tone="success" />
        <StatCard label="Rezerve + kapora" value={rezerve} icon={Clock3} tone="warning" />
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Henüz proje yok"
          description="İlk inşaat projenizi ekleyin; blok ve daireleri stok ızgarasında yönetin."
          action={canCreate ? { node: <NewProjectDialog /> } : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const total = p.units.length;
            const sold = p.units.filter((u) => u.status === "sold").length;
            const pct = total > 0 ? Math.round((sold / total) * 100) : 0;
            return (
              <div key={p.id} className="group relative rounded-[20px] border border-line bg-surface p-5">
                <Link
                  href={`/app/projeler/${p.id}`}
                  className="focus-ring absolute inset-0 rounded-[20px]"
                  aria-label={`${p.name} proje detayını aç`}
                />
                <div className="flex items-start justify-between gap-2">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <Badge variant={STATUS_VARIANT[p.status] ?? "default"} size="sm">
                    {STATUS_LABELS[p.status] ?? p.status}
                  </Badge>
                </div>

                <p className="mt-3 font-semibold text-ink-950">{p.name}</p>
                {p.developer_name ? <p className="text-xs text-text-muted">{p.developer_name}</p> : null}

                <div className="mt-2 space-y-1 text-xs text-text-muted">
                  {p.location ? (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {p.location}
                    </p>
                  ) : null}
                  <p className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {p.delivery_date
                      ? `Teslim: ${new Date(p.delivery_date).toLocaleDateString("tr-TR", { month: "long", year: "numeric" })}`
                      : "Teslim tarihi girilmedi"}
                  </p>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-text-muted">{total > 0 ? `${sold}/${total} satıldı` : "Henüz daire yok"}</span>
                    {total > 0 ? <span className="text-mint-600">%{pct}</span> : null}
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/8">
                    <div className="h-full rounded-full bg-mint-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
