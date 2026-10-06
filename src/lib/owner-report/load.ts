import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnerReportFacts } from "@/lib/owner-report/core";

/**
 * Bir portföyün haftalık rapor olguları. İstemci ÇAĞIRANDAN gelir (malik portalı / cron'un mevcut istemcisi);
 * her sorgu AÇIK tenant_id + property_id filtrelidir. Tablo/sütun yoksa ilgili satır "kayıt yok"a düşer (fırlatmaz).
 * Pencere: [startIso, endIso).
 */
export async function loadOwnerReportFacts(
  db: SupabaseClient,
  input: { tenantId: string; propertyId: string; startIso: string; endIso: string; startDay: string; endDayExclusive: string; prevStartDay: string },
): Promise<OwnerReportFacts> {
  const { tenantId, propertyId, startIso, endIso } = input;
  const [appts, offersNew, offersOpen, surveys, views, prevViews, listings] = await Promise.all([
    db
      .from("appointments")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("property_id", propertyId)
      .eq("appointment_type", "showing")
      .neq("status", "cancelled")
      .gte("scheduled_at", startIso)
      .lt("scheduled_at", endIso)
      .limit(500),
    db
      .from("offers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("property_id", propertyId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    db
      .from("offers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("property_id", propertyId)
      .eq("status", "submitted"),
    db
      .from("survey_tasks")
      .select("id, score")
      .eq("tenant_id", tenantId)
      .eq("property_id", propertyId)
      .eq("event_type", "appointment_done")
      .eq("status", "completed")
      .gte("completed_at", startIso)
      .lt("completed_at", endIso)
      .limit(200),
    db
      .from("listing_views")
      .select("count")
      .eq("tenant_id", tenantId)
      .eq("property_id", propertyId)
      .gte("day", input.startDay)
      .lt("day", input.endDayExclusive),
    db
      .from("listing_views")
      .select("count")
      .eq("tenant_id", tenantId)
      .eq("property_id", propertyId)
      .gte("day", input.prevStartDay)
      .lt("day", input.startDay),
    db
      .from("portal_listings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("property_id", propertyId)
      .eq("status", "live"),
  ]);

  const apptRows = appts.error ? [] : ((appts.data ?? []) as { status: string }[]);
  const surveyRows = surveys.error ? [] : ((surveys.data ?? []) as { id: string; score: number | null }[]);
  const scores = surveyRows.map((s) => s.score).filter((s): s is number => typeof s === "number");

  let reasons: { label: string; count: number }[] = [];
  if (surveyRows.length > 0) {
    const { data: answers, error } = await db
      .from("survey_answers")
      .select("value_text")
      .eq("tenant_id", tenantId)
      .eq("tag", "reason")
      .in("task_id", surveyRows.map((s) => s.id))
      .limit(500);
    if (!error) {
      const m = new Map<string, number>();
      for (const a of (answers ?? []) as { value_text: string | null }[]) {
        const v = (a.value_text ?? "").trim();
        if (v) m.set(v, (m.get(v) ?? 0) + 1);
      }
      reasons = [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    }
  }

  const sum = (rows: { count: number | null }[]) => rows.reduce((acc, r) => acc + (Number(r.count) || 0), 0);
  return {
    showings: { total: apptRows.length, completed: apptRows.filter((a) => a.status === "completed").length },
    offers: { newCount: offersNew.error ? 0 : (offersNew.count ?? 0), openCount: offersOpen.error ? 0 : (offersOpen.count ?? 0) },
    feedback: {
      answered: surveyRows.length,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      reasons,
    },
    views: {
      thisWeek: views.error ? null : sum((views.data ?? []) as { count: number | null }[]),
      prevWeek: prevViews.error ? null : sum((prevViews.data ?? []) as { count: number | null }[]),
    },
    liveListings: listings.error ? 0 : (listings.count ?? 0),
  };
}

export type RentStatementData = {
  firstStartDay: string | null;
  charges: { period: string; amount: number; status: string; paidAt: string | null }[];
  expenses: { title: string; cost: number | null; status: string; createdAt: string }[];
  rentalCount: number;
};

/** Portföyün kira kayıtları + seçilen yılın (ve ödeme kayması için önceki yılın Aralık'ının) tahakkuk/gider satırları. */
export async function loadRentStatementData(db: SupabaseClient, tenantId: string, propertyId: string, year: number): Promise<RentStatementData> {
  const { data: rentals, error } = await db
    .from("rentals")
    .select("id, start_date")
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .order("start_date", { ascending: true })
    .limit(50);
  const rows = error ? [] : ((rentals ?? []) as { id: string; start_date: string }[]);
  if (rows.length === 0) return { firstStartDay: null, charges: [], expenses: [], rentalCount: 0 };
  const ids = rows.map((r) => r.id);
  const [charges, maintenance] = await Promise.all([
    db
      .from("rent_charges")
      .select("period, amount, status, paid_at")
      .eq("tenant_id", tenantId)
      .in("rental_id", ids)
      .gte("period", `${year - 1}-12-01`)
      .lte("period", `${year}-12-01`)
      .limit(1000),
    db
      .from("maintenance_requests")
      .select("title, cost, status, created_at")
      .eq("tenant_id", tenantId)
      .in("rental_id", ids)
      .gte("created_at", `${year}-01-01T00:00:00+03:00`)
      .lt("created_at", `${year + 1}-01-01T00:00:00+03:00`)
      .limit(1000),
  ]);
  return {
    firstStartDay: rows[0]?.start_date ?? null,
    rentalCount: rows.length,
    charges: ((charges.data ?? []) as { period: string; amount: number | string; status: string; paid_at: string | null }[]).map((c) => ({
      period: String(c.period).slice(0, 10),
      amount: Number(c.amount),
      status: c.status,
      paidAt: c.paid_at,
    })),
    expenses: ((maintenance.data ?? []) as { title: string; cost: number | string | null; status: string; created_at: string }[]).map((m) => ({
      title: m.title,
      cost: m.cost != null ? Number(m.cost) : null,
      status: m.status,
      createdAt: m.created_at,
    })),
  };
}
