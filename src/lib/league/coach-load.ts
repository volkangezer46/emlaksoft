import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, trDayKey } from "@/lib/clock";
import { loadLeagueData, loadLeagueSettings, periodOf } from "@/lib/gamification-query";
import { loadLeadResponses } from "@/lib/response-time/load";
import { buildCoachPlan, type CoachFacts, type CoachItem, type CoachPlan } from "@/lib/league/coach";

type Row = Record<string, unknown>;

const LOOKBACK_DAYS = 14;
const LIST_LIMIT = 20;

async function rows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const res = await q;
  return res.error || !Array.isArray(res.data) ? [] : (res.data as Row[]);
}

/**
 * Kişisel koçluk olguları: YALNIZ bu kullanıcının gerçek bekleyen kayıtları + haftalık lig sırası.
 * Sorgular RLS'li oturum istemcisiyle çalışır; başkasının verisi çekilmez.
 */
export async function loadCoachPlan(
  client: SupabaseClient,
  opts: { tenantId: string; userId: string; nowMs: number },
): Promise<CoachPlan | null> {
  const { tenantId, userId, nowMs } = opts;
  const nowIso = new Date(nowMs).toISOString();
  const sinceIso = new Date(nowMs - LOOKBACK_DAYS * DAY_MS).toISOString();
  const confirmCutoffIso = new Date(nowMs - 7 * DAY_MS).toISOString();

  const settings = await loadLeagueSettings(client, tenantId);
  const week = periodOf(new Date(nowMs), "week");

  const [league, overdue, past, listings, responses] = await Promise.all([
    loadLeagueData(client, { period: week, tenantId, todayIso: trDayKey(nowMs), nowMs, settings }),
    rows(
      client
        .from("tasks")
        .select("id, title, due_at")
        .eq("tenant_id", tenantId)
        .eq("assigned_to", userId)
        .eq("status", "open")
        .not("due_at", "is", null)
        .lt("due_at", nowIso)
        .order("due_at", { ascending: true })
        .limit(LIST_LIMIT),
    ),
    rows(
      client
        .from("appointments")
        .select("id, appointment_type, scheduled_at, customer:customers!appointments_customer_id_fkey(full_name)")
        .eq("tenant_id", tenantId)
        .eq("assigned_to", userId)
        .not("status", "in", "(completed,cancelled)")
        .gte("scheduled_at", sinceIso)
        .lt("scheduled_at", nowIso)
        .order("scheduled_at", { ascending: false })
        .limit(LIST_LIMIT),
    ),
    rows(
      client
        .from("portal_listings")
        .select("id, portal_name, last_confirmed_at, property:properties!portal_listings_property_id_fkey(id, title, assigned_to)")
        .eq("tenant_id", tenantId)
        .eq("status", "live")
        .or(`last_confirmed_at.is.null,last_confirmed_at.lt.${confirmCutoffIso}`)
        .order("last_confirmed_at", { ascending: true, nullsFirst: true })
        .limit(100),
    ),
    loadLeadResponses(client, { tenantId, startIso: sinceIso, endIso: nowIso, assignedToIn: [userId], nowMs }),
  ]);

  const me = league.ranked.find((r) => r.staffId === userId) ?? null;
  const leaderTotal = league.ranked[0]?.total ?? 0;
  const runnerUp = league.ranked.find((r) => r.rank > 1)?.total ?? null;

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

  const overdueTasks: CoachItem[] = overdue.map((t) => ({
    id: String(t.id),
    label: String(t.title ?? "Görev"),
    href: `/app/gorevler?danisman=${userId}`,
  }));

  const pastAppointments = past.map((a) => {
    const cust = one(a.customer as { full_name?: string | null } | { full_name?: string | null }[] | null);
    return {
      id: String(a.id),
      label: `${cust?.full_name ?? "Randevu"} · ${new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(String(a.scheduled_at)))}`,
      href: `/app/randevular?danisman=${userId}`,
      isShowing: a.appointment_type === "showing",
    };
  });

  const unconfirmedListings: CoachItem[] = listings
    .map((l) => ({ l, p: one(l.property as { id?: string; title?: string; assigned_to?: string | null } | { id?: string; title?: string; assigned_to?: string | null }[] | null) }))
    .filter(({ p }) => p?.assigned_to === userId)
    .map(({ l, p }) => ({
      id: String(l.id),
      label: `${p?.title ?? "İlan"} · ${String(l.portal_name ?? "portal")}`,
      href: "/app/ilan-kontrol",
    }));

  const waitingLeads = responses.rows
    .filter((r) => !r.responded)
    .map((r) => ({
      id: r.customerId,
      label: `${r.name} · ${Math.round(r.minutes)} dk bekliyor`,
      href: `/app/musteriler/${r.customerId}`,
      withinSla: r.status === "bekliyor",
    }));

  const facts: CoachFacts = {
    ruleset: settings.ruleset,
    myRank: me ? me.rank : null,
    myTotal: me?.total ?? 0,
    leaderTotal,
    runnerUpTotal: runnerUp,
    overdueTasks,
    waitingLeads,
    unconfirmedListings,
    pastAppointments,
  };
  // Hiç yarışan / hiç bekleyen kayıt yoksa kart yok (boş vaat yok).
  if (!me && facts.overdueTasks.length + facts.waitingLeads.length + facts.unconfirmedListings.length + facts.pastAppointments.length === 0) {
    return null;
  }
  return buildCoachPlan(facts);
}
