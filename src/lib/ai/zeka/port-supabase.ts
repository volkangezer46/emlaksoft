import "server-only";
import { createClient } from "@/lib/supabase/server";
import { searchWorkspace } from "@/app/actions/search";
import { getListScope } from "@/lib/access-control/list-scope";
import { applyScopeFilter, type ScopeFilter } from "@/lib/access-control/query-scope";
import { applyPropertyNlFilters, normalizePropertyNlParams } from "@/lib/nl-search/property-filters";
import { OPEN_DEAL_STAGES, OPEN_DEMAND_STATUSES } from "@/lib/workflow-state";
import { now, trDayStartMs, DAY_MS } from "@/lib/clock";
import { periodIsoRange } from "./slots";
import type { MetricId, MetricValue } from "./metrics";
import type { MetricQuery, ZekaDataPort, ZekaRecordHit } from "./tools";
import type { ZekaAppScope } from "./scope";

/**
 * Uygulama yüzeyinin SALT-OKUNUR veri kapısı. Kullanıcının oturumlu Supabase istemcisi (RLS) + listelerle AYNI kapsam
 * süzgeci (`getListScope`: kendi / takım / şube); ofis geneli olmayan rolde anlaşmalar "kendi" kapsamındadır (arama ile
 * aynı kural). service_role KULLANILMAZ. Kayıt araması mevcut çalışma alanı aramasıdır (`searchWorkspace`).
 * Bu dosyada insert/update/delete/upsert/rpc-yazma YOKTUR (sözleşme testi kilitler).
 */

type Head = { count: number | null; error: unknown };

const SUM_SCAN = 1000;

export function createSupabaseZekaPort(scope: ZekaAppScope): ZekaDataPort {
  let filterP: Promise<ScopeFilter> | null = null;
  const scopeFilter = () =>
    (filterP ??= getListScope({ userId: scope.userId, tenantId: scope.tenantId, role: scope.role }).then(
      (s) => s.filter,
      () => ({ kind: "self", userId: scope.userId }) as ScopeFilter,
    ));

  return {
    async search(text: string, limit: number): Promise<ZekaRecordHit[]> {
      const hits = await searchWorkspace(text, Math.max(1, Math.min(limit, 20)));
      return hits.slice(0, limit).map((h) => ({ id: h.id, kind: h.kind, title: h.title, subtitle: h.subtitle, href: h.href }));
    },

    async metric(id: MetricId, q: MetricQuery): Promise<MetricValue | null> {
      const supabase = await createClient();
      const filter = await scopeFilter();
      const dealFilter: ScopeFilter = q.officeWide ? filter : { kind: "self", userId: scope.userId };
      const own = <Q,>(query: Q, f: ScopeFilter = filter, col = "assigned_to"): Q => applyScopeFilter(query, f, { ownerColumn: col });
      const range = q.period ? periodIsoRange(q.period) : null;
      const count = async (p: PromiseLike<Head>): Promise<MetricValue | null> => {
        const r = await p;
        return r.error ? null : { kind: "count", count: r.count ?? 0 };
      };
      const head = { count: "exact" as const, head: true };

      switch (id) {
        case "properties": {
          const nl = normalizePropertyNlParams(q.slots.propertyParams);
          let query = own(supabase.from("properties").select("id", head).eq("tenant_id", scope.tenantId).is("deleted_at", null));
          query = applyPropertyNlFilters(query, nl);
          if (q.slots.propertyParams.kategori) query = query.eq("property_type", q.slots.propertyParams.kategori);
          return count(query);
        }
        case "customers":
          return count(own(supabase.from("customers").select("id", head).eq("tenant_id", scope.tenantId).is("deleted_at", null)));
        case "demands_open":
          return count(
            own(
              supabase
                .from("customer_demands")
                .select("id, customer:customers!customer_demands_customer_id_fkey!inner(assigned_to)", head)
                .eq("tenant_id", scope.tenantId)
                .in("status", [...OPEN_DEMAND_STATUSES]),
              filter,
              "customer.assigned_to",
            ),
          );
        case "tasks_overdue":
          return count(own(supabase.from("tasks").select("id", head).eq("tenant_id", scope.tenantId).eq("status", "open").lt("due_at", new Date(now()).toISOString())));
        case "tasks_today": {
          const start = trDayStartMs();
          return count(
            own(
              supabase
                .from("tasks")
                .select("id", head)
                .eq("tenant_id", scope.tenantId)
                .eq("status", "open")
                .gte("due_at", new Date(start).toISOString())
                .lt("due_at", new Date(start + DAY_MS).toISOString()),
            ),
          );
        }
        case "tasks_open":
          return count(own(supabase.from("tasks").select("id", head).eq("tenant_id", scope.tenantId).eq("status", "open")));
        case "appointments": {
          let query = own(supabase.from("appointments").select("id", head).eq("tenant_id", scope.tenantId).neq("status", "cancelled"));
          if (range) query = query.gte("scheduled_at", range.fromIso).lt("scheduled_at", range.toIso);
          return count(query);
        }
        case "deals_open":
          return count(own(supabase.from("deals").select("id", head).eq("tenant_id", scope.tenantId).in("stage", [...OPEN_DEAL_STAGES]), dealFilter));
        case "deals_won": {
          let query = own(supabase.from("deals").select("id", head).eq("tenant_id", scope.tenantId).eq("stage", "won"), dealFilter);
          if (range) query = query.gte("closed_at", range.fromIso).lt("closed_at", range.toIso);
          return count(query);
        }
        case "sales_volume": {
          // Kapı (earnings_all) araçta uygulanır; burada ikinci savunma.
          if (!q.earnings) return null;
          let query = own(supabase.from("deals").select("deal_value").eq("tenant_id", scope.tenantId).eq("stage", "won"), dealFilter);
          if (range) query = query.gte("closed_at", range.fromIso).lt("closed_at", range.toIso);
          const { data, error } = await query.limit(SUM_SCAN);
          if (error) return null;
          const rows = (data ?? []) as { deal_value: number | string | null }[];
          return { kind: "money", amount: rows.reduce((s, r) => s + (Number(r.deal_value) || 0), 0), count: rows.length };
        }
        case "top_advisor": {
          if (!q.officeWide) return null;
          let query = supabase.from("deals").select("assigned_to, deal_value").eq("tenant_id", scope.tenantId).eq("stage", "won").not("assigned_to", "is", null);
          if (range) query = query.gte("closed_at", range.fromIso).lt("closed_at", range.toIso);
          const { data, error } = await query.limit(SUM_SCAN);
          if (error) return null;
          const agg = new Map<string, { count: number; amount: number }>();
          for (const r of (data ?? []) as { assigned_to: string; deal_value: number | string | null }[]) {
            const a = agg.get(r.assigned_to) ?? { count: 0, amount: 0 };
            a.count += 1;
            a.amount += Number(r.deal_value) || 0;
            agg.set(r.assigned_to, a);
          }
          const top = [...agg.entries()].sort((a, b) => b[1].count - a[1].count || b[1].amount - a[1].amount).slice(0, 5);
          if (top.length === 0) return { kind: "ranking", rows: [] };
          const { data: people } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", scope.tenantId).in("id", top.map(([uid]) => uid));
          const names = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "Danışman"]));
          // Tutar yalnız earnings_all ile (sayı ofis kapsamındaki yöneticiye açık).
          return { kind: "ranking", rows: top.map(([uid, v]) => ({ name: names.get(uid) ?? "Danışman", count: v.count, amount: q.earnings ? v.amount : null })) };
        }
        // Kira ve sözleşme sayıları ofis geneli: metrik kataloğu ofis kapsamı ister (`needsOfficeWide`); burada ikinci savunma.
        case "rent_overdue":
          if (!q.officeWide) return null;
          return count(supabase.from("rent_charges").select("id", head).eq("tenant_id", scope.tenantId).eq("status", "overdue"));
        case "rentals_active":
          if (!q.officeWide) return null;
          return count(supabase.from("rentals").select("id", head).eq("tenant_id", scope.tenantId).eq("status", "active"));
        case "offers_open":
          // Teklif listesiyle aynı kural: ofis geneli olmayan rol yalnız kendi oluşturduğu teklifleri sayar.
          return count(own(supabase.from("offers").select("id", head).eq("tenant_id", scope.tenantId).in("status", ["submitted", "countered"]), dealFilter, "created_by"));
        case "contracts_active":
          if (!q.officeWide) return null;
          return count(supabase.from("contracts").select("id", head).eq("tenant_id", scope.tenantId));
        case "commission_pending": {
          if (!q.earnings) return null;
          const { data, error } = await supabase.from("commissions").select("gross_amount").eq("tenant_id", scope.tenantId).not("status", "in", "(paid,collected)").limit(SUM_SCAN);
          if (error) return null;
          const rows = (data ?? []) as { gross_amount: number | string | null }[];
          return { kind: "money", amount: rows.reduce((s, r) => s + (Number(r.gross_amount) || 0), 0), count: rows.length };
        }
      }
    },
  };
}
