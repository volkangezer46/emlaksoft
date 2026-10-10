import Link from "@/components/ui/smart-link";
import { CalendarPlus, Home, Phone, UserPlus, ChevronRight, type LucideIcon } from "lucide-react";
import { daysAgoIso, now, trDayKey } from "@/lib/clock";
import { loadActivityFeed, type HomeCtx } from "./data";
import { homeHref, type HomeParams } from "./kapsam-anahtari";

/** Akış sorgusu kaynak başına en çok 5 satır çeker; dolu ise "5+" yazılır (sahte tam sayı yok). */
const FEED_CAP = 5;
const countText = (n: number) => (n >= FEED_CAP ? `${FEED_CAP}+` : String(n));

/**
 * "Bugün ofiste olanlar": canlı akışın (son 24 saat) tek bakışlık özeti. Her satır ilgili listeye gider;
 * ayrıntılı akış "Ofis özeti > Daha fazla" içindedir.
 */
export async function BugunOfiste({ ctx, params }: { ctx: HomeCtx; params: HomeParams }) {
  const feed = await loadActivityFeed(ctx);
  const nowMs = now();
  const from = trDayKey(daysAgoIso(1));
  const to = trDayKey(nowMs);
  const rows: { key: string; Icon: LucideIcon; label: string; n: number; href: string }[] = [
    { key: "musteri", Icon: UserPlus, label: "yeni müşteri", n: feed.customers.length, href: `/app/musteriler?from=${from}&to=${to}` },
    { key: "portfoy", Icon: Home, label: "yeni portföy", n: feed.properties.length, href: "/app/portfoyler" },
    { key: "arama", Icon: Phone, label: "arama", n: feed.calls.length, href: "/app/arama" },
    { key: "randevu", Icon: CalendarPlus, label: "yeni randevu", n: feed.appointments.length, href: "/app/randevular" },
  ];
  const live = rows.filter((r) => r.n > 0);
  return (
    <section aria-label="Bugün ofiste olanlar" className="ds-card ds-pad">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="ds-title">Bugün ofiste olanlar</h2>
        <Link href={homeHref(params, { ozet: "1", daha: "1" })} className="focus-ring text-xs font-semibold text-[var(--accent-text)] hover:underline">
          Tüm akış
        </Link>
      </header>
      {live.length === 0 ? (
        <p className="text-sm text-text-muted">Son 24 saatte yeni hareket yok.</p>
      ) : (
        <ul className="flex flex-col">
          {live.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="focus-ring group flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-1 py-1.5 hover:bg-surface-hover">
                <r.Icon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-sm text-text">
                  <span className="font-semibold tabular-nums">{countText(r.n)}</span> {r.label}
                </span>
                <ChevronRight className="h-4 w-4 text-text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
