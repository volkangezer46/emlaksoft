import Link from "@/components/ui/smart-link";
import { Megaphone } from "lucide-react";
import { EmptyArt } from "@/components/ui/premium";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { Widget } from "../dashboard-widgets";
import { afterFirstScreen, loadCustomerSources, type HomeCtx } from "./data";
import { sourceShares } from "./helpers";
import { PanelLink } from "./ortak";

/**
 * Müşteri kaynağı dağılımı — hangi kanaldan kaç müşteri geliyor. Yalnız gerçek `source`
 * kayıtları; her satır /app/musteriler?source=… filtresine gider. Kayıt sayısı sorgu
 * sınırını aşarsa (kırpık dağılım) kart hiç çizilmez.
 */
export async function KaynakDagilimi({ ctx }: { ctx: HomeCtx }) {
  await afterFirstScreen(ctx);
  const [data, defs] = await Promise.all([loadCustomerSources(ctx), getDefinitionsOrDefault("customer_source")]);
  if (!data) return null;
  const labels = new Map(defs.map((d) => [d.value, d.label] as const));
  const rows = sourceShares(data.counts, labels, 5);
  const known = rows.filter((r) => r.value !== "");

  return (
    <Widget id="kaynak" className="h-full">
      <section className="pm-bx flex h-full flex-col p-5" aria-labelledby="kaynak-baslik">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
            <h2 id="kaynak-baslik" className="pm-bx-title">
              Müşteri kaynağı
            </h2>
          </div>
          <PanelLink href="/app/musteriler">{data.total} müşteri</PanelLink>
        </div>
        {known.length === 0 ? (
          <div className="pm-empty flex-1">
            <EmptyArt kind="chart" />
            <p className="font-semibold text-[var(--text)]">Kaynak bilgisi girilmemiş</p>
            <p>Müşteri eklerken kaynağı seçin; kanal dağılımı burada görünür.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {rows.map((r) => (
              <li key={r.value || "_none"}>
                <Link
                  href={r.value ? `/app/musteriler?source=${encodeURIComponent(r.value)}` : "/app/musteriler"}
                  className="focus-ring group block rounded-[var(--radius-control)]"
                  aria-label={`${r.label}: ${r.count} müşteri, yüzde ${r.pct}`}
                >
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium text-[var(--text)] group-hover:text-[var(--accent-text)]">{r.label}</span>
                    <span className="pm-num shrink-0 text-xs text-[var(--text-muted)]">
                      {r.count} · %{r.pct}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]">
                    <span
                      className="block h-full rounded-full bg-[linear-gradient(90deg,var(--accent),color-mix(in_srgb,var(--accent)_60%,white))]"
                      style={{ width: `${Math.max(r.pct, 3)}%` }}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Widget>
  );
}
