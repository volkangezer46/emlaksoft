import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { cachedTenantAggregate } from "@/lib/cache/tenant-aggregate";
import { loadManagementPnlInputs } from "@/lib/property-management/load";

/**
 * Kâr/zarar sayfasının ORTAK ham verisi: son 12 ay komisyon (+ anlaşma sahibi danışman), komisyon payları ve giderler
 * (+ portföy sahibi danışman). Eskiden sayfa ve "Danışman kârlılığı" kartı aynı üç tabloyu ayrı ayrı (ve pay parçalarını
 * ardışık) okuyordu; artık TEK okuma: istek içinde React `cache()` ile paylaşılır, istekler arasında kısa TTL'li ofis
 * önbelleğinde (anahtar ofis + kullanıcı) durur, gider/komisyon/anlaşma yazmaları etiketi düşürür.
 * Yalnız tüm kazancı görenler için çağrılır (çağıran sayfa kapıyı uygular). Örnek veri hariç. Düz JSON döner.
 */
export type OfficeProfitCommission = {
  id: string;
  createdAt: string;
  gross: number;
  vat: number;
  status: string;
  /** Anlaşmanın sorumlu danışmanı (yoksa null). */
  advisorId: string | null;
};
export type OfficeProfitSplit = { commissionId: string; kind: string; amount: number };
export type OfficeProfitExpense = { date: string; amount: number; advisorId: string | null; /** Mülk sahibine yansıtıldı: ofis gideri sayılmaz. */ passThrough?: boolean };
export type OfficeProfitData = {
  commissions: OfficeProfitCommission[];
  splits: OfficeProfitSplit[];
  expenses: OfficeProfitExpense[];
  /** Yönetim ücreti geliri (iptal edilmemiş tahsilatlardan); mülk yönetimi migration'ı yoksa boş. */
  fees: { date: string; amount: number }[];
  advisorNames: Record<string, string>;
};

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const num = (v: unknown) => Number(v) || 0;

/** Okuma hatası fırlatır (eksik veriyle net hesaplanmaz; hata önbelleğe yazılmaz). */
export const loadOfficeProfitData = cache(async (tenantId: string, userId: string, firstMonthKey: string): Promise<OfficeProfitData> => {
  const supabase = await createClient();
  const startIso = `${firstMonthKey}-01T00:00:00+03:00`;
  return cachedTenantAggregate(
    "office-profit",
    { tenantId, userId, scope: firstMonthKey },
    async () => {
      const [commRes, expRes] = await Promise.all([
        fetchAllRows<{
          id: string;
          created_at: string;
          gross_amount: number | string;
          vat_amount: number | string | null;
          status: string;
          deal: Rel<{ assigned_to: string | null }>;
        }>((from, to) =>
          supabase
            .from("commissions")
            .select("id, created_at, gross_amount, vat_amount, status, deal:deals!commissions_deal_id_fkey(assigned_to)")
            .eq("tenant_id", tenantId)
            .eq("is_sample", false)
            .gte("created_at", startIso)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        fetchAllRows<{ id: string; expense_date: string; amount: number | string; property: Rel<{ assigned_to: string | null }> }>((from, to) =>
          supabase
            .from("expenses")
            .select("id, expense_date, amount, property:properties!expenses_property_id_fkey(assigned_to)")
            .eq("tenant_id", tenantId)
            .eq("is_sample", false)
            .gte("expense_date", `${firstMonthKey}-01`)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ]);
      if (commRes.error || expRes.error) throw new Error("office-profit: okuma hatası");

      const commissions: OfficeProfitCommission[] = commRes.data.map((c) => ({
        id: c.id,
        createdAt: c.created_at,
        gross: num(c.gross_amount),
        vat: num(c.vat_amount),
        status: c.status,
        advisorId: one(c.deal)?.assigned_to ?? null,
      }));

      // 200 komisyon × çok paylı kayıt 1000 satırı aşabilir (max_rows): parça başına sayfalı okuma, parçalar BİRLİKTE.
      const ids = commissions.map((c) => c.id);
      const parts: string[][] = [];
      for (let i = 0; i < ids.length; i += 200) parts.push(ids.slice(i, i + 200));
      const splitResults = await Promise.all(
        parts.map((part) =>
          fetchAllRows<{ commission_id: string; kind: string; amount: number | string }>((from, to) =>
            supabase
              .from("commission_splits")
              .select("id, commission_id, kind, amount")
              .eq("tenant_id", tenantId)
              .in("commission_id", part)
              .order("id", { ascending: true })
              .range(from, to),
          ),
        ),
      );
      const splits: OfficeProfitSplit[] = [];
      for (const res of splitResults) {
        if (res.error) throw new Error("office-profit: pay okuma hatası");
        for (const s of res.data) splits.push({ commissionId: s.commission_id, kind: s.kind, amount: num(s.amount) });
      }

      const pm = await loadManagementPnlInputs(supabase, { tenantId, firstMonthKey });
      const passThroughIds = pm.passThroughExpenseIds;
      const expenses: OfficeProfitExpense[] = expRes.data.map((e) => ({
        date: String(e.expense_date),
        amount: num(e.amount),
        advisorId: one(e.property)?.assigned_to ?? null,
        passThrough: passThroughIds.has(e.id),
      }));

      const advisorIds = [
        ...new Set([
          ...commissions.map((c) => c.advisorId),
          ...expenses.map((e) => e.advisorId),
        ].filter((x): x is string => Boolean(x))),
      ];
      const advisorNames: Record<string, string> = {};
      if (advisorIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", advisorIds.slice(0, 200));
        for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) advisorNames[p.id] = p.full_name ?? "Danışman";
      }

      return { commissions, splits, expenses, fees: pm.fees, advisorNames };
    },
    90,
  );
});
