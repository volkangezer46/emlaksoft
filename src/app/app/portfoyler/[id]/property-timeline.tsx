import {
  Banknote,
  CalendarClock,
  DoorOpen,
  History,
  ImageIcon,
  RadioTower,
  Tag,
  Workflow,
} from "lucide-react";
import type { TimelineEvent, TimelineKind } from "@/app/actions/property-timeline";

const IKON: Record<TimelineKind, typeof History> = {
  price: Banknote,
  status: Workflow,
  portal: RadioTower,
  appointment: CalendarClock,
  offer: Tag,
  openhouse: DoorOpen,
  media: ImageIcon,
};

const TON: Record<NonNullable<TimelineEvent["tone"]>, string> = {
  ok: "border-mint-500/40 bg-mint-500/10 text-mint-600",
  warn: "border-amber-400/40 bg-amber-400/12 text-amber-600",
  danger: "border-danger-500/35 bg-danger-500/10 text-danger-600",
  neutral: "border-line bg-canvas text-text-muted",
};

function tarih(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/** Aynı güne düşen olayları başlık altında toplar. */
function gunlereBol(olaylar: TimelineEvent[]) {
  const gruplar: { gun: string; olaylar: TimelineEvent[] }[] = [];
  for (const o of olaylar) {
    const gun = o.at.slice(0, 10);
    const son = gruplar[gruplar.length - 1];
    if (son && son.gun === gun) son.olaylar.push(o);
    else gruplar.push({ gun, olaylar: [o] });
  }
  return gruplar;
}

/**
 * Portföy zaman tüneli.
 *
 * NEDEN VAR: Fiyat geçmişi ve durum geçmişi ayrı iki bölümdü; ikisi de
 * doğruydu ama hikâyeyi anlatmıyorlardı. "Bu portföy neden satmıyor?"
 * sorusunun cevabı olayların SIRASINDA — ilan açıldı, 40 gün ziyaret yok,
 * fiyat düştü, iki ziyaret, liste altı teklif, reddedildi. Portal yayını,
 * teklif, randevu ve açık ev ise hiçbir kronolojide görünmüyordu.
 *
 * Boş durumda hiç render edilmiyor: bilgi taşımayan bir bölüm sayfayı uzatır.
 */
export function PropertyTimeline({ events, simdi }: { events: TimelineEvent[]; simdi: number }) {
  if (events.length === 0) return null;

  const gruplar = gunlereBol(events);
  // "Kac gundur izleniyor": en ESKI olaydan bugune. `simdi` disaridan geliyor
  // (react-hooks/purity: bilesen govdesinde Date.now cagrilmamali) ve boylece
  // sayfadaki tum zaman hesaplari ayni referans ani kullaniyor.
  const ilk = events[events.length - 1];
  const gun = Math.max(0, Math.round((simdi - new Date(ilk.at).getTime()) / 86_400_000));

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <History className="h-4 w-4 text-brand-600" /> Zaman tüneli
        </h2>
        <span className="rounded-full bg-canvas px-2.5 py-1 text-xs text-text-muted">
          <span className="numeric font-semibold text-ink-950">{events.length}</span> olay ·{" "}
          <span className="numeric font-semibold text-ink-950">{gun}</span> gündür izleniyor
        </span>
      </div>

      <div className="mt-4 space-y-5">
        {gruplar.map((g) => (
          <div key={g.gun}>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-faint">
              {new Intl.DateTimeFormat("tr-TR", { dateStyle: "full" }).format(new Date(g.gun))}
            </p>

            {/* Dikey çizgi: olayların tek bir akışa ait olduğunu gösterir. */}
            <ol className="relative mt-2 space-y-2 border-l border-line pl-5">
              {g.olaylar.map((o) => {
                const Ikon = IKON[o.kind] ?? History;
                return (
                  <li key={o.id} className="relative">
                    <span
                      className={`absolute -left-[26px] grid h-6 w-6 place-items-center rounded-full border ${
                        TON[o.tone ?? "neutral"]
                      }`}
                    >
                      <Ikon className="h-3 w-3" />
                    </span>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="text-sm font-semibold text-ink-950">{o.title}</p>
                      <time className="numeric text-[11px] text-text-faint" dateTime={o.at}>
                        {tarih(o.at)}
                      </time>
                    </div>
                    {o.detail ? <p className="text-xs text-text-muted">{o.detail}</p> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
