import Link from "@/components/ui/smart-link";
import { Phone, ArrowUpRight, Flame, AlarmClock, TrendingUp, MoonStar } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso, msSince, DAY_MS } from "@/lib/clock";
import { computeLeadScore } from "@/lib/lead-score";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { fetchLeadSignals } from "@/lib/lead-signals";
import { computeChurnRisk } from "@/lib/churn-risk";
import { scoreSellerLikelihood, isOwnerCustomer } from "@/lib/seller-prediction";

import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { EmptyState } from "@/components/ui/empty-state";
import { ICONS } from "@/lib/icons";
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

/** URL kontratı: ?segment=churn|hot|seller|dormant (boş = tüm gruplar). Başlık kartları ve çipler aynı parametreyi yazar. */
const PATH = "/app/akilli-listeler";
const SEGMENT_KEYS = ["churn", "hot", "seller", "dormant"] as const;
type SegmentKey = (typeof SEGMENT_KEYS)[number];
const segmentHref = (key: SegmentKey | "") => (key ? `${PATH}?segment=${key}` : PATH);

export default async function AkilliListelerPage({ searchParams }: { searchParams?: Promise<{ segment?: string }> }) {
  const { tenantId } = await requireModulePage("customers", PATH);
  const sp = (await searchParams) ?? {};
  const segmentF: SegmentKey | "" = (SEGMENT_KEYS as readonly string[]).includes(sp.segment ?? "") ? (sp.segment as SegmentKey) : "";
  const supabase = await createClient();

  const [custRes, upcomingRes] = await Promise.all([
    // max_rows (1000) sınırı: tüm müşteriler sayfalı okunur; eksik liste sessizce gösterilmez.
    fetchAllRows((from, to) =>
      supabase
        .from("customers")
        .select("id, full_name, phone, email, customer_types, blacklist, source, created_at")
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("appointments")
      .select("customer_id")
      .gte("scheduled_at", daysAgoIso(0))
      .in("status", ["pending", "confirmed"]),
  ]);
  assertQueryBatchSucceeded([custRes, upcomingRes], ["akilli-customers", "akilli-upcoming"], "Akıllı listeler");
  const { data: custData } = custRes;
  const { data: upcomingData } = upcomingRes;

  const customers = (custData ?? []) as Cust[];
  // Yalnız listelenen müşterilerin sinyalleri (tüm tenant'ı döndüren eski imza 1000 satırda kesiliyordu).
  const signalRes = await fetchLeadSignals(supabase, tenantId, customers.map((c) => c.id));
  assertQueryBatchSucceeded([signalRes], ["lead-signals"], "Akıllı listeler");
  const signalData = signalRes.data;
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

  const segments: Array<{
    key: SegmentKey;
    icon: typeof Flame;
    tone: "danger" | "amber" | "mint" | "brand";
    title: string;
    sub: string;
    emptyHint: string;
    rows: Enriched[];
    reason: (e: Enriched) => string;
    metric: (e: Enriched) => string;
  }> = [
    {
      key: "churn",
      icon: AlarmClock,
      tone: "danger",
      title: "Churn riski yüksek",
      sub: "Değerli ama sessizleşen müşteriler — bugün kurtar.",
      emptyHint: "Sessizleşen değerli müşteriniz yok; düzenli temas sürüyor.",
      rows: churnRisk,
      reason: (e) => e.churn.action,
      metric: (e) => `risk ${e.churn.risk}`,
    },
    {
      key: "hot",
      icon: Flame,
      tone: "amber",
      title: "Sıcak ama randevusuz",
      sub: "En sıcak adaylar; henüz planlı gösterim yok → randevu ver.",
      emptyHint: "Tüm sıcak adayların planlı bir randevusu var.",
      rows: hotNoAppt,
      reason: () => "Gösterim randevusu planla, momentumu kaybetme.",
      metric: (e) => `skor ${e.leadScore}`,
    },
    {
      key: "seller",
      icon: TrendingUp,
      tone: "mint",
      title: "Satışa çıkarabilir malikler",
      sub: "Listeleme olasılığı yüksek mülk sahipleri — portföy iste.",
      emptyHint: "Mülk sahibi tipinde ve listeleme sinyali veren müşteri yok; müşteri tipini 'Mülk sahibi' işaretlemeyi unutmayın.",
      rows: sellerReady,
      reason: (e) => e.seller?.reasons[0] ?? "",
      metric: (e) => `olasılık ${e.seller?.score ?? 0}`,
    },
    {
      key: "dormant",
      icon: MoonStar,
      tone: "brand",
      title: "Uzun sessiz değerliler",
      sub: "30+ gün temassız, hâlâ sıcak/ılık — yeniden ısıt.",
      emptyHint: "30 gündür temas kurulmamış sıcak/ılık müşteri yok.",
      rows: dormantValuable,
      reason: (e) => `${e.days} gündür temassız`,
      metric: (e) => `skor ${e.leadScore}`,
    },
  ];
  const shown = segmentF ? segments.filter((s) => s.key === segmentF) : segments;

  const TONE: Record<string, { chip: string; ico: string }> = {
    danger: { chip: "bg-danger-500/12 text-danger-600 ring-danger-500/25", ico: "text-danger-500" },
    amber: { chip: "bg-amber-400/15 text-amber-600 ring-amber-500/25", ico: "text-amber-500" },
    mint: { chip: "bg-mint-500/12 text-mint-600 ring-mint-500/25", ico: "text-mint-600" },
    brand: { chip: "bg-brand-600/12 text-brand-600 ring-brand-600/25", ico: "text-brand-600" },
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Akıllı Listeler" eyebrow="Kimi aramalıyım?" description={<>Müşterilerinizi son görüşme tarihine ve ilgisine göre gruplar; önce kimi arayacağınızı gösterir. <HelpTip topic="segment" label="Müşteri grupları" /></>} />

      <section className="theme-dark grid gap-3 rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-3 sm:p-4">
<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {/* Kartlar listeyi ?segment= ile süzer (sıfır çıkmaz metrik: sayı = hedef). */}
            {segments.map((s) => (
              <Link
                key={s.key}
                href={segmentHref(segmentF === s.key ? "" : s.key)}
                aria-current={segmentF === s.key ? "page" : undefined}
                className={`focus-ring press rounded-[var(--radius-card)] border px-3 py-2.5 text-center transition hover:border-white/30 ${
                  segmentF === s.key ? "border-white/40 bg-white/14" : "border-white/12 bg-white/8"
                }`}
              >
                <p className="font-display text-xl font-extrabold text-white">{s.rows.length}</p>
                <p className="text-xs text-white/60">{s.title}</p>
              </Link>
            ))}
          </div>
      </section>

      {active.length === 0 ? (
        <EmptyState
          illustration="musteri"
          title="Henüz gruplanacak müşteri yok"
          description="Akıllı listeler müşteri kayıtlarınızdan ve görüşme/randevu sinyallerinden beslenir; ilk müşterinizi ekleyince gruplar burada oluşur."
          action={{ href: "/app/musteriler/yeni", label: "İlk müşteriyi ekle" }}
          secondary={{ href: "/app/ice-aktarma", label: "Excel'den içe aktar" }}
        />
      ) : (
        <>
          {/* Grup çipleri: URL filtresi (?segment=) — sayaçlar gerçek, aktif çip tekrar tıklanınca süzgeç kalkar. */}
          <nav aria-label="Müşteri grubu süzgeci" className="flex flex-wrap items-center gap-2">
            <Link
              href={PATH}
              aria-current={!segmentF ? "page" : undefined}
              className={`focus-ring press rounded-full px-3 py-1.5 text-xs font-bold transition ${
                !segmentF ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:border-brand-300"
              }`}
            >
              Tüm gruplar · {active.length} müşteri
            </Link>
            {segments.map((s) => (
              <Link
                key={s.key}
                href={segmentHref(segmentF === s.key ? "" : s.key)}
                aria-current={segmentF === s.key ? "page" : undefined}
                className={`focus-ring press rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  segmentF === s.key ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:border-brand-300"
                } ${s.rows.length === 0 && segmentF !== s.key ? "opacity-55" : ""}`}
              >
                {s.title} · {s.rows.length}
              </Link>
            ))}
          </nav>

          {shown.map((s) => {
            const tone = TONE[s.tone]!;
            const Icon = s.icon;
            return (
              <section key={s.key} id={s.key} className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-canvas ${tone.ico}`}>
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
                  <EmptyState
                    className="mt-4"
                    variant="compact"
                    icon={Icon}
                    tone="mint"
                    title="Bu grupta müşteri yok"
                    description={s.emptyHint}
                    action={{ href: "/app/musteriler", label: "Müşteri listesine git" }}
                  />
                ) : (
                  <ul className="mt-4 space-y-2">
                    {s.rows.slice(0, segmentF ? 50 : 10).map((e) => (
                      <li
                        key={e.c.id}
                        className="group flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-2.5 transition hover:border-brand-300"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[image:var(--grad-brand)] text-xs font-bold text-white">
                          {e.c.full_name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink-950">{e.c.full_name}</p>
                          <p className="truncate text-xs text-text-muted">{s.reason(e)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${tone.chip}`}>
                          {s.metric(e)}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          {e.c.phone ? (
                            <a
                              href={`tel:${e.c.phone}`}
                              aria-label={`${e.c.full_name} ara`}
                              className="focus-ring grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-mint-600 transition hover:bg-mint-500/10"
                            >
                              <Phone className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                          <Link
                            href={`/app/musteriler/${e.c.id}`}
                            className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                          >
                            Kart <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {!segmentF && s.rows.length > 10 ? (
                  <Link
                    href={segmentHref(s.key)}
                    className="focus-ring mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                  >
                    Grubun tamamını gör ({s.rows.length}) <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                ) : null}
              </section>
            );
          })}

          {/* Hızlı eylemler: grup dışı sıradaki adımlar */}
          <aside className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-4 py-3 text-xs text-text-muted">
            <span className="font-semibold text-ink-950">Sıradaki adım:</span>
            <Link href="/app/randevular/yeni" className="focus-ring inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
              <ICONS.randevu className="h-3.5 w-3.5" aria-hidden /> Randevu planla
            </Link>
            <Link href="/app/gorevler/yeni" className="focus-ring inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
              <ICONS.gorev className="h-3.5 w-3.5" aria-hidden /> Takip görevi aç
            </Link>
            <Link href="/app/kampanyalar" className="focus-ring inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
              <ICONS.mesaj className="h-3.5 w-3.5" aria-hidden /> Toplu mesaj gönder
            </Link>
          </aside>
        </>
      )}
    </div>
  );
}
