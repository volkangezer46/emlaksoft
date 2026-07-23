import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Crosshair,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  scoreDemandProperty,
  tierCls,
  tierLabel,
  type MatchDemand,
  type MatchProperty,
} from "@/lib/matching";
import { moneyTry } from "@/lib/leak-shield";
import { requireModulePage } from "@/lib/require-module-page";
import { SaveMatchButton } from "./save-match-button";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

type DemandRow = MatchDemand & {
  customer: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
};

function customerOf(d: DemandRow) {
  return Array.isArray(d.customer) ? d.customer[0] : d.customer;
}

function budgetLabel(min: number | null, max: number | null) {
  if (min != null && max != null) return `${moneyTry(min)} – ${moneyTry(max)}`;
  if (max != null) return `≤ ${moneyTry(max)}`;
  if (min != null) return `≥ ${moneyTry(min)}`;
  return "Bütçe yok";
}

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ demand?: string; property?: string; customer?: string }>;
}) {
  await requireModulePage("matching");
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: demandsData }, { data: propertiesData }] = await Promise.all([
    supabase
      .from("customer_demands")
      .select(
        "id, transaction_type, property_type, province_id, district_id, budget_min, budget_max, rooms, min_sqm, urgency, status, customer:customers(id, full_name)",
      )
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("properties")
      .select(
        "id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, features",
      )
      .is("deleted_at", null)
      .in("status", ["live", "draft", "reserved", "Yayında"])
      .order("created_at", { ascending: false })
      .limit(120),
  ]);

  let demands = (demandsData ?? []) as DemandRow[];
  const properties = (propertiesData ?? []).map((p) => ({
    ...p,
    list_price: p.list_price != null ? Number(p.list_price) : null,
    features: (p.features ?? {}) as MatchProperty["features"],
  })) as MatchProperty[];

  if (sp.customer) {
    demands = demands.filter((d) => customerOf(d)?.id === sp.customer);
  }
  if (sp.demand) {
    demands = demands.filter((d) => d.id === sp.demand);
  }

  type Pair = {
    demand: DemandRow;
    property: MatchProperty;
    score: number;
    tier: ReturnType<typeof scoreDemandProperty>["tier"];
    reasons: ReturnType<typeof scoreDemandProperty>["reasons"];
  };

  const pairs: Pair[] = [];
  for (const demand of demands) {
    for (const property of properties) {
      if (sp.property && property.id !== sp.property) continue;
      const result = scoreDemandProperty(demand, property);
      if (result.score < 35) continue;
      pairs.push({
        demand,
        property,
        score: result.score,
        tier: result.tier,
        reasons: result.reasons,
      });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const top = pairs.slice(0, 40);
  const strong = pairs.filter((p) => p.tier === "strong").length;
  const good = pairs.filter((p) => p.tier === "good").length;
  const avg = pairs.length ? Math.round(pairs.reduce((s, p) => s + p.score, 0) / pairs.length) : 0;
  const hitRate = demands.length && properties.length
    ? Math.min(1, pairs.length / Math.max(1, demands.length))
    : 0;

  const scoreBuckets = [0, 0, 0, 0]; // 35-54, 55-74, 75-89, 90+
  pairs.forEach((p) => {
    if (p.score >= 90) scoreBuckets[3] += 1;
    else if (p.score >= 75) scoreBuckets[2] += 1;
    else if (p.score >= 55) scoreBuckets[1] += 1;
    else scoreBuckets[0] += 1;
  });
  const maxBucket = Math.max(1, ...scoreBuckets);

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-cyan-400/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <Crosshair className="h-4 w-4" /> Talep × Portföy eşleştirme
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Akıllı eşleşme motoru</h1>
            <p className="mt-1 max-w-lg text-sm text-white/60">
              Müşteri taleplerini portföylerle bütçe, konum, oda ve işlem türüne göre skorlar. Scraping yok — kendi veriniz.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-xl font-extrabold">{demands.length}</p>
                <p className="text-[10px] text-white/45">Açık talep</p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-xl font-extrabold">{properties.length}</p>
                <p className="text-[10px] text-white/45">Portföy</p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-xl font-extrabold text-mint-400">{strong}</p>
                <p className="text-[10px] text-white/45">Güçlü eşleşme</p>
              </div>
              <div className="rounded-[14px] border border-white/10 bg-white/5 p-3">
                <p className="font-display text-xl font-extrabold text-cyan-300">{good}</p>
                <p className="text-[10px] text-white/45">İyi eşleşme</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--cyan-400), var(--mint-400), var(--cyan-400))" }}
              />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--cyan-400)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * (1 - hitRate) } as CSSProperties}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-xl font-extrabold">{avg || 0}</p>
                <p className="text-[9px] text-white/45">ort. skor</p>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Skor dağılımı</p>
              <div className="mt-3 flex h-20 items-end gap-2">
                {["35–54", "55–74", "75–89", "90+"].map((label, i) => (
                  <div key={label} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-white/80">{scoreBuckets[i]}</span>
                    <div
                      className="bar-live w-full max-w-[28px] rounded-t-[4px] bg-gradient-to-t from-cyan-500 to-mint-400"
                      style={{ height: `${Math.max((scoreBuckets[i] / maxBucket) * 100, 8)}%`, animationDelay: `${i * 0.08}s` }}
                    />
                    <span className="text-[8px] text-white/35">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {(sp.customer || sp.demand || sp.property) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-cyan-400/30 bg-cyan-400/8 px-4 py-3 text-sm text-ink-950">
          <Sparkles className="h-4 w-4 text-cyan-600" />
          Filtre aktif
          {sp.customer ? <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold">müşteri</span> : null}
          {sp.demand ? <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold">talep</span> : null}
          {sp.property ? <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold">portföy</span> : null}
          <Link href="/app/eslestirme" className="ml-auto text-xs font-semibold text-brand-600">Filtreyi temizle</Link>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Target className="h-4 w-4 text-brand-600" /> Eşleşme önerileri
            </h2>
            <p className="text-xs text-text-muted">{top.length} öneri · skor ≥ 35</p>
          </div>
        </div>

        {top.length === 0 ? (
          <div className="grid place-items-center px-6 py-14 text-center">
            <Crosshair className="h-8 w-8 text-text-faint" />
            <p className="mt-3 font-display font-bold text-ink-950">Henüz eşleşme yok</p>
            <p className="mt-1 max-w-md text-sm text-text-muted">
              Açık talep ve yayında portföy ekleyin. Bütçe / il / oda örtüşünce burada skorlanır.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/app/musteriler" className="rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Müşteriler</Link>
              <Link href="/app/portfoyler" className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-ink-950">Portföyler</Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {top.map((pair) => {
              const customer = customerOf(pair.demand);
              return (
                <article
                  key={`${pair.demand.id}-${pair.property.id}`}
                  className="grid gap-4 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.1fr_1.1fr_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-600">
                      <Users className="h-3 w-3" /> Talep
                    </p>
                    <Link
                      href={customer ? `/app/musteriler/${customer.id}` : "/app/musteriler"}
                      className="mt-1 block truncate font-display text-base font-bold text-ink-950 hover:text-brand-600"
                    >
                      {customer?.full_name ?? "Müşteri"}
                    </Link>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {pair.demand.transaction_type}
                      {pair.demand.property_type ? ` · ${pair.demand.property_type}` : ""}
                      {pair.demand.rooms ? ` · ${pair.demand.rooms}` : ""}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink-950">
                      {budgetLabel(
                        pair.demand.budget_min != null ? Number(pair.demand.budget_min) : null,
                        pair.demand.budget_max != null ? Number(pair.demand.budget_max) : null,
                      )}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-mint-600">
                      <Building2 className="h-3 w-3" /> Portföy
                    </p>
                    <Link
                      href={`/app/portfoyler/${pair.property.id}`}
                      className="mt-1 block truncate font-display text-base font-bold text-ink-950 hover:text-brand-600"
                    >
                      {pair.property.title ?? pair.property.property_code}
                    </Link>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {pair.property.property_code} · {pair.property.transaction_type} · {pair.property.property_type}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink-950">
                      {pair.property.list_price != null ? moneyTry(pair.property.list_price) : "Fiyat yok"}
                    </p>
                  </div>

                  <div className="flex flex-col items-start gap-2 lg:items-end">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-2xl font-extrabold text-ink-950">{pair.score}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${tierCls(pair.tier)}`}>
                        {tierLabel(pair.tier)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 lg:justify-end">
                      {pair.reasons.filter((r) => r.ok).slice(0, 4).map((r) => (
                        <span key={r.label} className="rounded-full bg-mint-500/10 px-2 py-0.5 text-[9px] font-semibold text-mint-600">
                          {r.label}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <SaveMatchButton demandId={pair.demand.id} propertyId={pair.property.id} />
                      <Link
                        href={`/app/portfoyler/${pair.property.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600"
                      >
                        Portföyü aç <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
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
