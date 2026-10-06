import Link from "next/link";
import { ArrowUpRight, BellRing, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/clock";
import { getChangesSince } from "@/lib/listing-control/server/readers";
import { buildChangeLines } from "@/components/listing-control/helpers";
import { loadStaleDeals, type HomeCtx } from "./data";
import { buildAdvisorWarnings, crmChangeItems, nonZero, type ChangeItem } from "./ofis-nabzi-core";

/** Danışman sinyallerinde okunan en çok satır (PostgREST 1000 sınırının altında; tavana ulaşılırsa not düşülür). */
const ROW_CAP = 1000;

type Ids = { ids: (string | null)[]; capped: boolean } | null;

/**
 * OFİS NABZI (yalnız yönetim + "Ofis geneli" görünümü): "Dünden beri ne değişti" + "Bugün kimi uyarmalıyım".
 * Mükerrer üretmez: İlan Kontrol değişimleri `listing_control_changes_since` RPC'si + `buildChangeLines` (İlan Kontrol özetiyle
 * aynı), riskli anlaşma eşiği `loadStaleDeals` (Dikkat listesiyle aynı ayar). Veri yoksa kart çizilmez.
 */
export async function OfisNabzi({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.isManagement || ctx.scopeMine || !ctx.tenantId) return null;
  const supabase = await createClient();
  const since = daysAgoIso(1);
  const nowIso = daysAgoIso(0);
  const canPortals = (ctx.perms.portals ?? []).includes("view");

  const ids = async (p: PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>, col: string): Promise<Ids> => {
    const r = await p;
    if (r.error || !r.data) return null;
    return { ids: r.data.map((row) => (row[col] as string | null) ?? null), capped: r.data.length >= ROW_CAP };
  };

  const [demands, props, lc, stale, advisorsRes, overdue, staleDeals, sla] = await Promise.all([
    ctx.sample.apply(supabase.from("customer_demands").select("id", { count: "exact", head: true })).gte("created_at", since),
    ctx.canSeeProperties
      ? ctx.sample.apply(supabase.from("properties").select("id", { count: "exact", head: true })).is("deleted_at", null).gte("created_at", since)
      : Promise.resolve(null),
    canPortals ? getChangesSince(supabase, since) : Promise.resolve(null),
    loadStaleDeals(ctx).catch(() => null),
    supabase.from("profiles").select("id, full_name").eq("tenant_id", ctx.tenantId).eq("is_active", true).limit(500),
    ids(ctx.sample.apply(supabase.from("tasks").select("assigned_to")).eq("status", "open").lt("due_at", nowIso).limit(ROW_CAP), "assigned_to"),
    loadStaleDeals(ctx)
      .then((s) =>
        ids(
          ctx.sample.apply(supabase.from("deals").select("assigned_to")).not("stage", "in", "(won,lost)").lt("updated_at", daysAgoIso(s.days)).limit(ROW_CAP),
          "assigned_to",
        ),
      )
      .catch(() => null),
    canPortals
      ? ids(
          supabase.from("listing_anomalies").select("advisor_id").in("status", ["open", "acknowledged"]).lt("sla_due_at", nowIso).limit(ROW_CAP),
          "advisor_id",
        )
      : Promise.resolve(null),
  ]);

  const changes: ChangeItem[] = [
    ...crmChangeItems({
      newDemands: demands.error ? null : (demands.count ?? 0),
      newProperties: props && !props.error ? (props.count ?? 0) : null,
    }),
    ...(lc?.available && lc.changes ? nonZero(buildChangeLines(lc.changes).filter((c) => c.key !== "checks")) : []),
  ];
  const advisors = (advisorsRes.data ?? []).map((a) => ({ id: a.id as string, name: ((a.full_name as string | null) ?? "").trim() || "Adsız üye" }));
  const warnings = buildAdvisorWarnings({
    advisors,
    overdueTasks: overdue?.ids ?? null,
    staleDeals: staleDeals?.ids ?? null,
    slaBreaches: sla?.ids ?? null,
    staleDays: stale?.days ?? 14,
  });
  const capped = Boolean(overdue?.capped || staleDeals?.capped || sla?.capped);
  if (changes.length === 0 && warnings.length === 0) return null;

  return (
    <section aria-label="Ofis nabzı" className="grid gap-4 lg:grid-cols-2">
      <div className="ds-card ds-pad">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <History className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" /> Dünden beri ne değişti
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">Son 24 saat · her sayı ilgili listeyi açar</p>
        {changes.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">Son 24 saatte yeni talep, portföy ya da ilan değişimi yok.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {changes.map((c) => (
              <li key={c.key}>
                <Link
                  href={c.href}
                  className="focus-ring surface-interactive flex min-h-14 flex-col justify-center rounded-[var(--radius-control)] border border-line px-3 py-2 hover:border-brand-400"
                >
                  <span className="text-lg font-semibold tabular-nums text-text">{c.value}</span>
                  <span className="text-xs text-text-muted">{c.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="ds-card ds-pad">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <BellRing className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" /> Bugün kimi uyarmalıyım
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">Geciken görev, hareketsiz anlaşma ve süresi aşılan ilan uyarısı olan danışmanlar</p>
        {warnings.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">Bugün uyarı gerektiren danışman yok.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {warnings.map((w) => (
              <li key={w.id} className="py-2.5">
                <Link href={w.href} className="focus-ring group inline-flex items-center gap-1 rounded-[var(--radius-control)] text-sm font-semibold text-text">
                  {w.name}
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--text-faint)] group-hover:text-[var(--accent-text)]" aria-hidden="true" />
                </Link>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {w.chips.map((c) => (
                    <Link
                      key={c.signal}
                      href={c.href}
                      className={`focus-ring ds-pill ${c.signal === "gorev" ? "pm-t-warn" : "pm-t-danger"} inline-flex min-h-7 items-center rounded-full bg-[var(--t-soft)] px-2.5 text-xs font-semibold text-[var(--t-text)]`}
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {capped ? <p className="mt-2 text-xs text-text-muted">Çok sayıda kayıt var; liste ilk {ROW_CAP} kayıttan hesaplandı.</p> : null}
      </div>
    </section>
  );
}
