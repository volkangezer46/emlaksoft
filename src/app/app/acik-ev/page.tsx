import Link from "next/link";
import { DoorOpen, Users, CalendarDays, MapPin } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listOpenHouses } from "@/app/actions/targets-openhouse-sources";
import { EmptyState } from "@/components/app/empty-state";

const STATUS_LABELS: Record<string, string> = {
  planned:   "Planlandı",
  active:    "Devam ediyor",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

type PropertyRel = { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;

function propertyLabel(p: PropertyRel) {
  if (!p) return "—";
  const item = Array.isArray(p) ? p[0] : p;
  return item?.title ?? item?.property_code ?? "—";
}

export default async function AcikEvPage() {
  await requireModulePage("open_house");
  const events = await listOpenHouses();

  const upcoming  = events.filter((e) => new Date(e.scheduled_at) >= new Date() && e.status !== "cancelled");
  const completed = events.filter((e) => e.status === "completed");
  const totalVisitors = events.reduce((s, e) => s + (e.visitor_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <DoorOpen className="h-4 w-4" /> Açık ev günleri
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Açık Ev Takibi</h1>
            <p className="mt-1 text-sm text-white/75">Portföy tanıtım günlerini ve ziyaretçi kayıtlarını yönetin.</p>
          </div>
          <div className="flex gap-3">
            {[
              { label: "Yaklaşan", value: upcoming.length },
              { label: "Tamamlanan", value: completed.length },
              { label: "Toplam ziyaretçi", value: totalVisitors },
            ].map((k) => (
              <div key={k.label} className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
                <p className="font-display text-2xl font-extrabold text-white">{k.value}</p>
                <p className="text-[10px] text-white/70">{k.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {events.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="Henüz açık ev etkinliği yok"
          description="Portföy randevu sayfasından açık ev günü ekleyebilirsiniz."
          tone="mint"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => {
            const date = new Date(e.scheduled_at);
            // Palet disi Tailwind varsayilanlari (blue/emerald/zinc/red) proje
            // token'lariyla degistirildi; ayni ekranda iki farkli mavi vardi.
            const statusColor: Record<string, string> = {
              planned:   "bg-brand-600/10 text-brand-600",
              active:    "bg-mint-500/12 text-mint-600",
              completed: "bg-ink-950/6 text-text-muted",
              cancelled: "bg-danger-500/10 text-danger-600",
            };
            return (
              <div key={e.id} className="group relative rounded-[20px] border border-line bg-surface p-5">
                {/* Ortu-link ONCEDEN PORTFOYE gidiyordu: acik ev kartina
                    tiklayinca etkinlik degil portfoy aciliyordu ve ziyaretci
                    listesine ulasilacak HICBIR yol yoktu. Artik acik ev
                    detayina gidiyor; portfoy bagi detay sayfasinda ayri kart. */}
                <Link
                  href={`/app/acik-ev/${e.id}`}
                  className="focus-ring absolute inset-0 rounded-[20px]"
                  aria-label={`${propertyLabel(e.property)} açık ev detayını aç`}
                />
                <div className="flex items-start justify-between gap-2">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600">
                    <DoorOpen className="h-5 w-5" />
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusColor[e.status] ?? statusColor.planned}`}>
                    {STATUS_LABELS[e.status] ?? e.status}
                  </span>
                </div>

                <p className="mt-3 font-semibold text-ink-950">{propertyLabel(e.property)}</p>

                <div className="mt-2 space-y-1 text-xs text-text-muted">
                  <p className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {date.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {e.duration_min && <span>({e.duration_min} dk)</span>}
                  </p>
                  {e.location && (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {e.location}
                    </p>
                  )}
                  <p className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {e.visitor_count ?? 0} ziyaretçi
                    {e.max_visitors && ` / maks. ${e.max_visitors}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
