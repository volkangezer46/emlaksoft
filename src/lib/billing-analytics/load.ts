import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { loadInternalTenantIds } from "@/lib/billing/mrr-snapshot";
import { now, trDayKey, trMonthKey } from "@/lib/clock";
import type { MonthEndRow } from "./mrr-movements";

/**
 * PA-3 okuyucusu (yalnız sunucu, platform raporları): son `MONTHS` TR ayının ofis × ay sonu MRR'ı
 * (`platform_mrr_month_end` RPC, migration 20261019070000) + ofislerin kayıt ayı + iç/demo ofis kümesi.
 * Aynı istekte üç rapor kartı (MRR hareketleri, NRR/GRR, kohort) tek okumayı paylaşır (`cache`).
 * Fonksiyon yoksa `missing` (kart "kurulum bekliyor" der), okunamazsa `error`; sayı uydurulmaz.
 */
export const REVENUE_MONTHS = 13;

export type RevenueAnalytics =
  | { status: "ok"; months: string[]; rows: MonthEndRow[]; signups: { id: string; month: string }[]; internal: ReadonlySet<string> }
  | { status: "missing" }
  | { status: "error" };

const MISSING_FN = /PGRST202|42883|Could not find the function|does not exist/i;

export const loadRevenueAnalytics = cache(async (): Promise<RevenueAnalytics> => {
  const admin = createAdminClient();
  const nowMs = now();
  const months = Array.from({ length: REVENUE_MONTHS }, (_, i) => trMonthKey(nowMs, i - (REVENUE_MONTHS - 1)));
  const [snap, tenants, internal] = await Promise.all([
    fetchAllRowsKeepError<{ tenant_id: string; month: string; mrr: number | string }, { message: string; code?: string }>((from, to) =>
      admin
        .rpc("platform_mrr_month_end", { p_from: `${months[0]}-01`, p_to: trDayKey(nowMs) })
        .order("month", { ascending: true })
        .order("tenant_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRowsKeepError<{ id: string; created_at: string }, { message: string; code?: string }>((from, to) =>
      admin.from("tenants").select("id, created_at").order("id", { ascending: true }).range(from, to),
    ),
    loadInternalTenantIds(admin),
  ]);
  if (snap.error) {
    if (MISSING_FN.test(`${snap.error.code ?? ""} ${snap.error.message}`)) return { status: "missing" };
    console.error("[billing-analytics] ay sonu MRR okunamadı", snap.error.code ?? snap.error.message);
    return { status: "error" };
  }
  if (tenants.error) return { status: "error" };
  return {
    status: "ok",
    months,
    rows: snap.data,
    signups: tenants.data.map((t) => ({ id: t.id, month: trMonthKey(t.created_at) })),
    internal,
  };
});
