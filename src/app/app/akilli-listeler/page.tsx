import Link from "next/link";
import { Phone, ArrowUpRight, Flame, AlarmClock, TrendingUp, MoonStar, ListFilter } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso, msSince, DAY_MS } from "@/lib/clock";
import { computeLeadScore } from "@/lib/lead-score";
import { computeChurnRisk } from "@/lib/churn-risk";
import { scoreSellerLikelihood, isOwnerCustomer } from "@/lib/seller-prediction";

export const metadata = { title: "Akıllı Listeler" };

type Cust = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  customer_types: string[] | null;
  blacklist: boolean | null;
  source: string | null;
  created_at: string;
};
type Signal = {
  customer_id: string;
  active_demands: number;
  comms: number;
  appts: number;
  calls: number;
  last_activity: string | null;
};

const daysOf = (iso: string | null) => (iso ? Math.floor(msSince(iso) / DAY_MS) : null);

export default async function AkilliListelerPage() {
  const { tenantId } = await requireModulePage("customers");
  const supabase = await createClient();

  const [{ data: custData }, { data: signalData }, { data: upcomingData }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, phone, email, customer_types, blacklist, source, created_at")
      .is("deleted_at", null)
      .limit(3000),
    supabase.rpc("customer_lead_signals", { p_tenant_id: tenantId }),
    supabase
      .from("appointments")
      .select("customer_id")
      .gte("scheduled_at", daysAgoIso(0))
      .in("status", ["pending", "confirmed"]),
  ]);

  const customers = (custData ?? []) as Cust[];
  const sigMap = new Map<string, Signal>();
  for (const s of (signalData ?? []) as Signal[]) sigMap.set(s.customer_id, s);
  const hasUpcoming = new Set(
    ((upcomingData ?? []) as { customer_id: string | null }[]).map((a) => a.customer_id).filter(Boolean) as string[],
  );

  type Enriched = {
    c: Cust;
    days: number | null;
    leadScore: number;
    leadTier: "hot" | "warm" | "cold";
    churn: ReturnType<typeof computeChurnRisk>;
    seller: ReturnType<typeof scoreSellerLikelihood> | null;
    upcoming: boolean;
    openDemands: number;
  };

  const enriched: Enriched[] = customers.map((c) => {
    const s = sigMap.get(c.id);
    const days = daysOf(s?.last_activity ?? c.created_at);
    const lead = computeLeadScore({
      hasPhone: Boolean(c.phone),
      hasEmail: Boolean(c.email),
      source: c.source,
      activeDemands: s?.active_demands ?? 0,
      communications: s?.comms ?? 0,
      appointments: s?.appts ?? 0,
      calls: s?.calls ?? 0,
      lastActivityAt: s?.last_activity ?? null,
      createdAt: c.created_at,
      blacklist: Boolean(c.blacklist),
    });
    const upcoming = hasUpcoming.has(c.id);
    const openDemands = s?.active_demands ?? 0;
    const churn = computeChurnRisk({
      daysSinceContact: daysOf(s?.last_activity ?? null),
      engagementScore: lead.score,
      openDemands,
      hasUpcomingAppointment: upcoming,
      blacklist: Boolean(c.blacklist),
    });
    const seller = isOwnerCustomer(c.customer_types)
      ? scoreSellerLikelihood({
          isOwnerType: true,
          daysSinceContact: daysOf(s?.last_activity ?? null),
          tenureDays: daysOf(c.created_at) ?? 0,
          pastWonDeals: 0,
          hasListingIntentDemand: false,
        })
      : null;
    return { c, days, leadScore: lead.score, leadTier: lead.tier, churn, seller, upcoming, openDemands };
  });

  const active = enriched.filter((e) => !e.c.blacklist);

  // --- Segmentler ---------------------------------------------------------
  const churnRisk = active
    .filter((e) => e.churn.tier === "high")
    .sort((a, b) => b.churn.risk - a.churn.risk);

  const hotNoAppt = active
    .filter((e) => e.leadTier === "hot" && !e.upcoming)
    .sort((a, b) => b.leadScore - a.leadScore);

  const sellerReady = active
    .filter((e) => e.seller && e.seller.tier !== "low")
    .sort((a, b) => (b.seller?.score ?? 0) - (a.seller?.score ?? 0));

  const dormantValuable = active
    .filter((e) => (e.days ?? 0) >= 30 && e.leadTier !== "cold" && !e.upcoming && e.churn.tier !== "high")
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

  const segments = [
    {
      key: "churn",
      icon: AlarmClock,
      tone: "danger" as const,
      title: "Churn riski yüksek",
      sub: "Değerli ama sessizleşen müşteriler — bugün kurtar.",
      rows: churnRisk,
      reason: (e: Enriched) => e.churn.action,
      metric: (e: Enriched) => `risk ${e.churn.risk}`,
    },
    {
      key: "hot",
      icon: Flame,
      tone: "amber" as const,
      title: "Sıcak ama randevusuz",
      sub: "En sıcak adaylar; henüz planlı gösterim yok → randevu ver.",
      rows: hotNoAppt,
      reason: () => "Gösterim randevusu planla, momentumu kaybetme.",
      metric: (e: Enriched) => `skor ${e.leadScore}`,
    },
    {
      key: "seller",
      icon: TrendingUp,
      tone: "mint" as const,
      title: "Satışa çıkarabilir malikler",
      sub: "Listeleme olasılığı yüksek mülk sahipleri — portföy iste.",
      rows: sellerReady,
      reason: (e: Enriched) => e.seller?.reasons[0] ?? "",
      metric: (e: Enriched) => `olasılık ${e.seller?.score ?? 0}`,
    },
    {
      key: "dormant",
      icon: MoonStar,
      tone: "brand" as const,
      title: "Uzun sessiz değerliler",
      sub: "30+ gün temassız, hâlâ sıcak/ılık — yeniden ısıt.",
      rows: dormantValuable,
      reason: (e: Enriched) => `${e.days} gündür temassız`,
      metric: (e: Enriched) => `skor ${e.leadScore}`,
    },
  ];

  const TONE: Record<string, { chip: string; ico: string }> = {
    danger: { chip: "bg-danger-500/12 text-danger-600 ring-danger-500/25", ico: "text-danger-500" },
    amber: { chip: "bg-amber-400/15 text-amber-600 ring-amber-500/25", ico: "text-amber-500" },
    mint: { chip: "bg-mint-500/12 text-mint-600 ring-mint-500/25", ico: "text-mint-600" },
    brand: { chip: "bg-brand-600/12 text-brand-600 ring-brand-600/25", ico: "text-brand-600" },
  };

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-600/30 blur-[70px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <ListFilter className="h-4 w-4" /> Davranışsal segmentler
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Akıllı Listeler</h1>
            <p className="mt-1 max-w-xl text-sm text-white/70">
              Müşteri tabanını her sabah otomatik tarar; kimi arayacağını davranış sinyallerinden
              önceliklendirir. Statik filtre değil — skor, churn ve niyet birleşimi.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {segments.map((s) => (
              <a
                key={s.key}
                href={`#${s.key}`}
                className="focus-ring press rounded-[14px] border border-white/12 bg-white/8 px-3 py-2.5 text-center transition hover:border-white/30"
              >
                <p className="font-display text-xl font-extrabold text-white">{s.rows.length}</p>
                <p className="text-[11px] text-white/60">{s.title}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {segments.map((s) => {
        const tone = TONE[s.tone];
        const Icon = s.icon;
        return (
          <section key={s.key} id={s.key} className="scroll-mt-24 rounded-[20px] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className={`grid h-9 w-9 place-items-center rounded-[11px] bg-canvas ${tone.ico}`}>
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div>
                  <h2 className="font-display text-base font-bold text-ink-950">{s.title}</h2>
                  <p className="text-xs text-text-muted">{s.sub}</p>
                </div>
              </div>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${tone.chip}`}>
                {s.rows.length} müşteri
              </span>
            </div>

            {s.rows.length === 0 ? (
              <p className="mt-4 rounded-[12px] border border-dashed border-line bg-canvas/60 px-4 py-6 text-center text-sm text-text-muted">
                Bu segmentte müşteri yok — temiz iş 👏
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {s.rows.slice(0, 10).map((e) => (
                  <li
                    key={e.c.id}
                    className="group flex flex-wrap items-center gap-3 rounded-[13px] border border-line bg-canvas/50 px-3 py-2.5 transition hover:border-brand-300"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[image:var(--grad-brand)] text-xs font-bold text-white">
                      {e.c.full_name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-950">{e.c.full_name}</p>
                      <p className="truncate text-xs text-text-muted">{s.reason(e)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${tone.chip}`}>
                      {s.metric(e)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {e.c.phone ? (
                        <a
                          href={`tel:${e.c.phone}`}
                          aria-label={`${e.c.full_name} ara`}
                          className="grid h-8 w-8 place-items-center rounded-[9px] border border-line text-mint-600 transition hover:bg-mint-500/10"
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                      <Link
                        href={`/app/musteriler/${e.c.id}`}
                        className="inline-flex items-center gap-1 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                      >
                        Kart <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
