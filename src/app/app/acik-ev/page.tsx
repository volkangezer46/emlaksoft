import Link from "next/link";
import { DoorOpen, Users, CalendarDays, MapPin } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listOpenHouses } from "@/app/actions/targets-openhouse-sources";
import { EmptyState } from "@/components/app/empty-state";
import { NewOpenHouseDialog } from "./new-open-house-dialog";

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

const FILTER_LABELS: Record<string, string> = {
  yaklasan: "Yaklaşan",
  ...STATUS_LABELS,
};

export default async function AcikEvPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string }>;
}) {
  const { perms } = await requireModulePage("open_house");
  const params = (await searchParams) ?? {};
  const durum = Object.keys(FILTER_LABELS).includes(params.durum ?? "") ? params.durum : undefined;
  const events = await listOpenHouses();
  const canCreate = (perms.open_house ?? perms.appointments ?? []).includes("create");

  const now = new Date();
  const upcoming  = events.filter((e) => new Date(e.scheduled_at) >= now && e.status !== "cancelled");
  const completed = events.filter((e) => e.status === "completed");
  const totalVisitors = events.reduce((s, e) => s + (e.visitor_count ?? 0), 0);

  const filtered = events.filter((e) => {
    if (!durum) return true;
    if (durum === "yaklasan") return new Date(e.scheduled_at) >= now && e.status !== "cancelled";
    return e.status === durum;
  });

  const kpis = [
    { label: "Yaklaşan", value: upcoming.length, href: "/app/acik-ev?durum=yaklasan", active: durum === "yaklasan" },
    { label: "Tamamlanan", value: completed.length, href: "/app/acik-ev?durum=completed", active: durum === "completed" },
    { label: "Toplam ziyaretçi", value: totalVisitors, href: "/app/acik-ev", active: false },
  ];

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
            {canCreate ? (
              <div className="mt-4">
                <NewOpenHouseDialog />
              </div>
            ) : null}
          </div>
          <div className="flex gap-3">
            {kpis.map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className={`focus-ring press lift block rounded-[14px] border p-3 text-center transition ${
                  k.active ? "border-mint-400/50 bg-white/12" : "border-white/12 bg-white/8 hover:border-white/30"
                }`}
              >
                <p className="font-display text-2xl font-extrabold text-white">{k.value}</p>
                <p className="text-[11px] text-white/70">{k.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {durum ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 font-semibold text-brand-600">
            Filtre: {FILTER_LABELS[durum]}
          </span>
          <Link href="/app/acik-ev" className="font-semibold text-text-muted underline-offset-2 hover:text-brand-600 hover:underline">
            Temizle
          </Link>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title={events.length === 0 ? "Henüz açık ev etkinliği yok" : "Filtreye uyan etkinlik yok"}
          description={
            events.length === 0
              ? "İlk açık ev gününüzü bu ekrandan planlayın; ziyaretçileri kapıda kaydedin."
              : "Filtreyi temizleyip tüm etkinlikleri görebilirsiniz."
          }
          tone="mint"
          action={
            events.length === 0 && canCreate
              ? { node: <NewOpenHouseDialog /> }
              : events.length > 0
                ? { href: "/app/acik-ev", label: "Filtreyi temizle" }
                : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => {
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
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusColor[e.status] ?? statusColor.planned}`}>
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
