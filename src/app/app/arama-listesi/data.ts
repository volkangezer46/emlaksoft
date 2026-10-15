import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerStates } from "@/lib/customer-state/load";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { applyScopeFilter, type ScopeFilter } from "@/lib/access-control/query-scope";
import { getInsightsForUser } from "@/lib/insights/read";
import { buildCallList, CALL_LIST_MAX, type CallListCandidate, type CallListEntry } from "@/lib/call-list";
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

  const [custRes, insights] = await Promise.all([
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
  ]);
  assertQueryBatchSucceeded([custRes], ["call-list-customers"], "Arama listesi");
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

  return buildCallList(candidates, priorityIds, CALL_LIST_MAX).map((e) => ({
    ...e,
    phoneLabel: formatTurkishPhone(e.phone) || e.phone,
    telHref: toTelHref(e.phone),
    waHref: toWhatsAppLink(e.phone),
    href: `/app/musteriler/${e.customerId}`,
  }));
}
