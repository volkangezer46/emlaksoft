import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerStates } from "@/lib/customer-state/load";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { applyScopeFilter, type ScopeFilter } from "@/lib/access-control/query-scope";
import { getInsightsForUser } from "@/lib/insights/read";
import { buildCallList, CALL_LIST_MAX, mergeCallTasks, type CallListCandidate, type CallListEntry, type CallTaskInput } from "@/lib/call-list";
import { DAY_MS, now, trDayStartMs } from "@/lib/clock";
import { toTelHref, toWhatsAppLink, formatTurkishPhone } from "@/lib/phone";

/** Kapsamdaki son müşteriler (ana ekrandaki "Bugün ara" ile aynı pencere genişliğinin üstü). */
const CANDIDATE_LIMIT = 300;
const CUSTOMER_SELECT = "id, full_name, phone, email, source, blacklist, created_at, customer_types";

type CustomerRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  blacklist: boolean | null;
  created_at: string;
  customer_types: string[] | null;
};

export type CallListRowVM = CallListEntry & {
  phoneLabel: string;
  telHref: string | null;
  waHref: string | null;
  href: string;
};

/**
 * Arama listesi verisi. Kaynaklar ana ekranla aynı: müşteri durumu tek okuyucudan (`loadCustomerStates`),
 * öncelik `call_priority` içgörülerinden. Müşteri sorgusu liste kapsamı (`scopeFilter`) + RLS ile kiracıya sınırlı.
 */
export async function loadCallList(input: {
  tenantId: string | null;
  userId: string;
  role: string;
  scopeFilter: ScopeFilter;
}): Promise<CallListRowVM[]> {
  const supabase = await createClient();
  const scoped = <Q,>(q: Q): Q => applyScopeFilter(q, input.scopeFilter, { ownerColumn: "assigned_to" });

  // GA-05: vadesi bugün sonuna kadar olan AÇIK arama görevleri aynı kuyrukta (sorumlu kapsamı müşteriyle aynı süzgeç).
  const dayEndIso = new Date(trDayStartMs(now()) + DAY_MS).toISOString();
  const [custRes, insights, taskRes] = await Promise.all([
    scoped(
      supabase
        .from("customers")
        .select(CUSTOMER_SELECT)
        .is("deleted_at", null)
        .not("phone", "is", null)
        .order("created_at", { ascending: false })
        .limit(CANDIDATE_LIMIT),
    ),
    input.tenantId ? getInsightsForUser({ tenantId: input.tenantId, userId: input.userId, role: input.role, limit: 50 }) : Promise.resolve([]),
    scoped(
      supabase
        .from("tasks")
        .select("id, title, due_at, customer_id, customer:customers!tasks_customer_id_fkey(full_name, phone, blacklist, deleted_at)")
        .eq("kind", "call")
        .eq("status", "open")
        .lt("due_at", dayEndIso)
        .order("due_at", { ascending: true })
        .limit(CALL_LIST_MAX),
    ),
  ]);
  assertQueryBatchSucceeded([custRes, taskRes], ["call-list-customers", "call-list-tasks"], "Arama listesi");
  const customers = [...((custRes.data ?? []) as CustomerRow[])];

  const priorityIds = insights
    .filter((i) => i.kind === "call_priority" && i.entityType === "customer" && i.entityId)
    .map((i) => i.entityId as string);
  // Öncelikli ama son 300 kaydın dışında kalan müşteriler tek sorguyla eklenir (aynı kapsam).
  const known = new Set(customers.map((c) => c.id));
  const missing = [...new Set(priorityIds.filter((id) => !known.has(id)))];
  if (missing.length > 0) {
    const extra = await scoped(supabase.from("customers").select(CUSTOMER_SELECT).is("deleted_at", null).in("id", missing));
    assertQueryBatchSucceeded([extra], ["call-list-priority"], "Arama listesi");
    customers.push(...((extra.data ?? []) as CustomerRow[]));
  }

  const states = await loadCustomerStates(supabase, input.tenantId, customers, { context: "Arama listesi" });
  const candidates: CallListCandidate[] = customers.map((c) => {
    const st = states.get(c.id);
    return {
      id: c.id,
      name: c.full_name ?? "Müşteri",
      phone: c.phone,
      blacklist: Boolean(c.blacklist),
      state: st
        ? {
            temperature: st.temperature,
            risk: st.risk,
            nextBestAction: st.nextBestAction,
            daysSinceContact: st.daysSinceContact,
            reasons: st.reasons,
            heatScore: st.scores.heat.score,
          }
        : null,
    };
  });

  type TaskRow = {
    id: string;
    title: string;
    due_at: string | null;
    customer_id: string | null;
    customer:
      | { full_name: string | null; phone: string | null; blacklist: boolean | null; deleted_at: string | null }
      | { full_name: string | null; phone: string | null; blacklist: boolean | null; deleted_at: string | null }[]
      | null;
  };
  const callTasks: CallTaskInput[] = ((taskRes.data ?? []) as TaskRow[]).map((t) => {
    const c = Array.isArray(t.customer) ? (t.customer[0] ?? null) : t.customer;
    const alive = c && !c.deleted_at ? c : null;
    return {
      id: t.id,
      title: t.title,
      dueAt: t.due_at,
      customerId: alive ? t.customer_id : null,
      customerName: alive?.full_name ?? null,
      phone: alive?.phone ?? null,
      blacklist: Boolean(alive?.blacklist),
    };
  });

  return mergeCallTasks(buildCallList(candidates, priorityIds, CALL_LIST_MAX), callTasks, now()).map((e) => ({
    ...e,
    phoneLabel: formatTurkishPhone(e.phone) || e.phone,
    telHref: toTelHref(e.phone),
    waHref: toWhatsAppLink(e.phone),
    href: e.customerId ? `/app/musteriler/${e.customerId}` : `/app/gorevler?gorev=${e.task?.id ?? ""}`,
  }));
}
