import Link from "@/components/ui/smart-link";
import { AlarmClock, ArrowUpRight, Phone, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now, daysAgoIso } from "@/lib/clock";
import { getLossReasonOptions } from "@/lib/definitions";
import { lossReasonLabels } from "@/lib/loss-reason";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { loadCustomerStates } from "@/lib/customer-state/load";
import { EmptyState } from "@/components/ui/empty-state";
import { RiskRowActions } from "./risk-row-actions";
import { LossReasons, type ClosedDeal } from "./loss-reasons";
import { ACTION_SEGMENTS, type ActionSegment } from "./keys";

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

const ICON = { risk: AlarmClock, satici: TrendingUp } as const;
const TONE = {
  risk: { chip: "bg-danger-500/12 text-danger-600 ring-danger-500/25", ico: "text-danger-500" },
  satici: { chip: "bg-mint-500/12 text-mint-600 ring-mint-500/25", ico: "text-mint-600" },
} as const;

/**
 * Müşteriler listesinin EYLEM süzgeçleri (`?segment=risk|satici`): sıcaklık süzgeçlerinin (Sıcak · İlgili · Soğuk ·
 * Uykuda) yanında, tam durum okuyucusunun (customer-state) risk ve satıcı skorlarıyla oluşan "bugün kimi aramalıyım?"
 * listeleri. Skor müşteri listesi, 360 ve ana ekranla AYNI kaynaktan gelir. Kara listedeki müşteri listelenmez.
 *  - risk: değerli ama sessizleşen müşteriler (Arandı / 1 hafta ertele ile listeden düşer) + son 12 ayın kayıp nedenleri
 *  - satici: listeleme olasılığı yüksek mülk sahipleri
 */
export async function ActionSegmentList({ segment, tenantId }: { segment: ActionSegment; tenantId: string | null }) {
  const supabase = await createClient();
  const [custRes, closedDealsRes, lossOptions] = await Promise.all([
    // max_rows (1000) sınırı: tüm müşteriler sayfalı okunur; eksik liste sessizce gösterilmez.
    fetchAllRows((from, to) =>
      supabase
        .from("customers")
        .select("id, full_name, phone, email, customer_types, blacklist, source, created_at")
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    segment === "risk" && tenantId
      ? supabase.from("deals").select("stage, deal_value, loss_reason").eq("tenant_id", tenantId).eq("stage", "lost").gte("updated_at", daysAgoIso(365)).limit(1000)
      : Promise.resolve(null),
    segment === "risk" ? getLossReasonOptions() : Promise.resolve(null),
  ]);
  assertQueryBatchSucceeded(
    [custRes, ...(closedDealsRes ? [closedDealsRes] : [])],
    ["segment-customers", ...(closedDealsRes ? ["segment-lost-deals"] : [])],
    "Müşteri süzgeci",
  );
  const customers = ((custRes.data ?? []) as Cust[]).filter((c) => !c.blacklist);
  const stateMap = await loadCustomerStates(supabase, tenantId, customers, { nowMs: now(), context: "Müşteri süzgeci" });

  const rows = customers
    .map((c) => ({ c, state: stateMap.get(c.id)! }))
    .filter(({ state }) => (segment === "risk" ? state.risk === "yuksek" : Boolean(state.scores.seller && state.scores.seller.tier !== "low")))
    .sort((a, b) =>
      segment === "risk" ? b.state.scores.churn.risk - a.state.scores.churn.risk : (b.state.scores.seller?.score ?? 0) - (a.state.scores.seller?.score ?? 0),
    );

  const meta = ACTION_SEGMENTS[segment];
  const Icon = ICON[segment];
  const tone = TONE[segment];

  return (
    <section id={`segment-${segment}`} className="scroll-mt-24 space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={`grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-canvas ${tone.ico}`}>
            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-base font-bold text-ink-950">{meta.title}</h2>
            <p className="text-xs text-text-muted">{meta.sub}</p>
          </div>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${tone.chip}`}>{rows.length} müşteri</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState variant="compact" icon={Icon} tone="mint" title="Bu süzgeçte müşteri yok" description={meta.emptyHint} action={{ href: "/app/musteriler", label: "Tüm müşteriler" }} />
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 100).map(({ c, state }) => (
            <li key={c.id} className="group flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-2.5 transition hover:border-brand-300">
              <div className="min-w-0 flex-1">
                <Link href={`/app/musteriler/${c.id}`} className="block truncate text-sm font-semibold text-ink-950 hover:text-brand-600">
                  {c.full_name}
                </Link>
                <p className="truncate text-xs text-text-muted">{segment === "risk" ? state.scores.churn.action : (state.scores.seller?.reasons[0] ?? "")}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${tone.chip}`}>
                {segment === "risk" ? `risk ${state.scores.churn.risk}` : `olasılık ${state.scores.seller?.score ?? 0}`}
              </span>
              {segment === "risk" ? (
                <RiskRowActions customerId={c.id} name={c.full_name} phone={c.phone} />
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  {c.phone ? (
                    <a
                      href={`tel:${c.phone}`}
                      aria-label={`${c.full_name} ara`}
                      className="focus-ring grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-mint-600 transition hover:bg-mint-500/10 touch:min-h-11 touch:min-w-11"
                    >
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  <Link
                    href={`/app/musteriler/${c.id}`}
                    className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                  >
                    Kart <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length > 100 ? <p className="text-xs text-text-faint">İlk 100 müşteri gösteriliyor (en yüksek skordan).</p> : null}

      {segment === "risk" && closedDealsRes ? (
        <LossReasons deals={(closedDealsRes.data ?? []) as ClosedDeal[]} reasonLabels={lossReasonLabels(lossOptions ?? [])} />
      ) : null}
    </section>
  );
}
