import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Radar,
  ShieldAlert,
  Siren,
  TrendingDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { moneyTry } from "@/lib/leak-shield";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

type Closure = {
  id: string;
  reason: string;
  deal_happened: boolean | null;
  deal_amount: number | null;
  closed_by_us: boolean | null;
  competitor_closed: boolean | null;
  estimated_lost_commission: number | null;
  created_at: string;
  portal_listing: {
    portal_name: string;
    portal_listing_id: string | null;
    property: { property_code: string; title: string | null } | { property_code: string; title: string | null }[] | null;
  } | {
    portal_name: string;
    portal_listing_id: string | null;
    property: { property_code: string; title: string | null } | { property_code: string; title: string | null }[] | null;
  }[] | null;
};

function listingOf(c: Closure) {
  return Array.isArray(c.portal_listing) ? c.portal_listing[0] : c.portal_listing;
}
function propertyOf(c: Closure) {
  const listing = listingOf(c);
  const p = listing?.property;
  return Array.isArray(p) ? p[0] : p;
}

function daysSince(value: string | null) {
  if (!value) return 999;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

export default async function LeakShieldPage() {
  await requireModulePage("leak");
  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ data: closures }, { data: listings }] = await Promise.all([
    supabase
      .from("listing_closures")
      .select(
        "id, reason, deal_happened, deal_amount, closed_by_us, competitor_closed, estimated_lost_commission, created_at, portal_listing:portal_listings(portal_name, portal_listing_id, property:properties(property_code, title))",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("portal_listings")
      .select("id, portal_name, portal_listing_id, status, last_confirmed_at, property:properties(property_code, title)")
      .eq("status", "live")
      .limit(200),
  ]);

  const rows = (closures ?? []) as Closure[];
  const live = listings ?? [];
  const overdue = live.filter((r) => daysSince(r.last_confirmed_at) >= 7);

  const monthRows = rows.filter((r) => new Date(r.created_at) >= monthStart);
  const lostMonth = monthRows.reduce((s, r) => s + Number(r.estimated_lost_commission || 0), 0);
  const lostAll = rows.reduce((s, r) => s + Number(r.estimated_lost_commission || 0), 0);
  const competitor = rows.filter((r) => r.competitor_closed).length;
  const ours = rows.filter((r) => r.closed_by_us).length;
  const leakRows = rows.filter((r) => Number(r.estimated_lost_commission || 0) > 0);

  // 8-week lost commission buckets
  const weekMs = 7 * 86_400_000;
  const nowMs = Date.now();
  const buckets = Array.from({ length: 8 }, () => 0);
  rows.forEach((r) => {
    const idx = 7 - Math.floor((nowMs - new Date(r.created_at).getTime()) / weekMs);
    if (idx >= 0 && idx < 8) buckets[idx] += Number(r.estimated_lost_commission || 0);
  });
  const maxBucket = Math.max(1, ...buckets);
  const pts = buckets.map((b, i) => ({
    x: (i / 7) * 280,
    y: 72 - (b / maxBucket) * 52 - 8,
  }));
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `0,80 ${line} 280,80`;
  const last = pts[pts.length - 1] ?? { x: 280, y: 40 };

  const reasonCounts = new Map<string, number>();
  rows.forEach((r) => reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1));
  const reasonBars = [...reasonCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const maxReason = Math.max(1, ...reasonBars.map((r) => r.count));

  const leakShare = rows.length ? leakRows.length / rows.length : 0;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-danger-500/25 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-danger-400">
              <span className="status-pulse h-2 w-2 rounded-full bg-danger-400" /> Leak Shield · Kayıp-kaçak
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Kaçan komisyon motoru</h1>
            <p className="mt-1 max-w-lg text-sm text-white/60">
              Portal kapanışlarından otomatik hesaplanan tahmini kayıp. Rakip / ofis dışı işlemler burada görünür.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-lg font-extrabold text-danger-400">{moneyTry(lostMonth)}</p>
                <p className="text-[10px] text-white/45">Bu ay kayıp</p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-lg font-extrabold">{moneyTry(lostAll)}</p>
                <p className="text-[10px] text-white/45">Toplam kayıp</p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-lg font-extrabold text-amber-300">{competitor}</p>
                <p className="text-[10px] text-white/45">Rakip kapanış</p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-lg font-extrabold text-warn-500">{overdue.length}</p>
                <p className="text-[10px] text-white/45">Teyit gecikmiş</p>
              </div>
            </div>
          </div>

          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75">
                <TrendingDown className="h-3.5 w-3.5 text-danger-400" /> Kayıp trend · 8 hafta
              </p>
              <span className="rounded-full bg-danger-500/15 px-2 py-0.5 text-[10px] font-bold text-danger-300">
                {moneyTry(buckets[7] ?? 0)}
              </span>
            </div>
            <svg viewBox="0 0 280 80" className="mt-3 h-24 w-full overflow-visible" preserveAspectRatio="none">
              <defs>
                <linearGradient id="leakFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--danger-500)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--danger-500)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={area} fill="url(#leakFill)" />
              <polyline
                className="chart-draw"
                style={{ "--len": 420 } as CSSProperties}
                points={line}
                fill="none"
                stroke="var(--danger-500)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={last.x} cy={last.y} r="4" fill="var(--danger-500)" opacity="0.35" className="glow-halo" />
              <circle cx={last.x} cy={last.y} r="3" fill="#fff" />
            </svg>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-danger-500">
            <Siren className="h-4 w-4" /> Kaçak oranı
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Kapanış kalitesi</h2>
          <div className="mt-5 flex items-center gap-4">
            <div className="relative grid h-28 w-28 place-items-center">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="10" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--danger-500)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * (1 - leakShare) } as CSSProperties}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-lg font-extrabold text-ink-950">%{Math.round(leakShare * 100)}</p>
                <p className="text-[9px] text-text-faint">kaçak</p>
              </div>
            </div>
            <div className="space-y-2 text-xs text-text-muted">
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-mint-500" /> {ours} bizim kapanış</div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-danger-500" /> {competitor} rakip</div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" /> {rows.length} toplam kayıt</div>
            </div>
          </div>
        </section>

        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
            <ShieldAlert className="h-4 w-4" /> Neden dağılımı
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Kapanış sebepleri</h2>
          {reasonBars.length === 0 ? (
            <p className="mt-6 text-sm text-text-muted">Henüz kapanış kaydı yok. Portal Kontrol’den ilan kapatınca burada görünür.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {reasonBars.map((r, i) => (
                <div key={r.label}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-semibold text-ink-950">{r.label}</span>
                    <span className="tabular-nums text-text-muted">{r.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-canvas">
                    <div
                      className="bar-live h-full rounded-full bg-[image:var(--grad-brand)]"
                      style={{ width: `${(r.count / maxReason) * 100}%`, animationDelay: `${i * 0.08}s` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {overdue.length > 0 ? (
        <section className="rounded-[20px] border border-warn-500/30 bg-warn-500/5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warn-500" />
              <h2 className="font-display font-bold text-ink-950">Teyit gecikmiş ilanlar</h2>
            </div>
            <Link href="/app/portallar" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
              Portal Kontrol <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {overdue.slice(0, 6).map((r) => {
              const prop = Array.isArray(r.property) ? r.property[0] : r.property;
              return (
                <div key={r.id} className="rounded-[12px] border border-line bg-surface px-3 py-2.5 text-sm">
                  <p className="font-semibold text-ink-950">{r.portal_name} {r.portal_listing_id ? `#${r.portal_listing_id}` : ""}</p>
                  <p className="text-xs text-text-muted">{prop?.property_code ?? "—"} · {daysSince(r.last_confirmed_at)} gündür teyit yok</p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Radar className="h-4 w-4 text-danger-500" /> Kapanış kayıtları
            </h2>
            <p className="text-xs text-text-muted">{rows.length} kayıt · tahmini kayıp otomatik hesaplanır</p>
          </div>
          <Link href="/app/portallar" className="text-xs font-semibold text-brand-600">Portal Kontrol</Link>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-text-muted">
            Henüz kapanış yok. Yayından kalkan ilanı “Kapat” ile kaydedin — kayıp-kaçak burada oluşur.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((r) => {
              const listing = listingOf(r);
              const prop = propertyOf(r);
              const lost = Number(r.estimated_lost_commission || 0);
              return (
                <article key={r.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1.4fr_.8fr_.7fr] sm:items-center">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {listing?.portal_name ?? "Portal"}{" "}
                      {listing?.portal_listing_id ? `#${listing.portal_listing_id}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {prop?.property_code ?? "—"} · {prop?.title ?? "Portföy"} · {r.reason}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.competitor_closed ? (
                      <span className="rounded-full bg-danger-500/10 px-2.5 py-1 text-[10px] font-bold text-danger-500">Rakip</span>
                    ) : null}
                    {r.closed_by_us ? (
                      <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-[10px] font-bold text-mint-600">Bizim</span>
                    ) : null}
                    {r.deal_happened ? (
                      <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[10px] font-bold text-brand-600">İşlem var</span>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className={`font-display text-base font-extrabold ${lost > 0 ? "text-danger-500" : "text-mint-600"}`}>
                      {lost > 0 ? `−${moneyTry(lost)}` : "Kayıp yok"}
                    </p>
                    <p className="text-[11px] text-text-faint">
                      {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(r.created_at))}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
