import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MATRIX, type AppRole } from "@/lib/permissions";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import {
  buildAdvisorMetrics,
  currentMonthPeriod,
  earningInRange,
  loadAdvisorMetrics,
  loadTargetActualsLive,
  trMonthPeriod,
  trYearPeriod,
  type MetricsFacts,
} from "./advisor-metrics";
import { summarizeAdvisorEarning } from "./advisor-share";

/* ------------------------------------------------------------------ */
/* Sahte Supabase istemcisi: tablo başına sabit veri, filtreleri kaydeder */
/* ------------------------------------------------------------------ */

type Filter = { op: string; col: string; val: unknown };
type Fixture = {
  profiles: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  calls: Record<string, unknown>[];
  appointments: Record<string, unknown>[];
  offers: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  commissions: Record<string, unknown>[];
  targets: Record<string, unknown>[];
};

function fakeClient(fx: Fixture) {
  const commissionQueries: { kind: "all" | "own-deal" | "own-split"; viewer?: unknown }[] = [];
  const client = {
    from(table: keyof Fixture) {
      const filters: Filter[] = [];
      let head = false;
      const builder: Record<string, unknown> = {};
      const chain = (op: string) => (col: string, val?: unknown) => {
        filters.push({ op, col, val });
        return builder;
      };
      for (const op of ["eq", "neq", "in", "gte", "lt", "not", "is", "contains", "order", "limit"]) builder[op] = chain(op);
      builder.select = (_cols: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return builder;
      };
      builder.then = (resolve: (v: unknown) => unknown) => {
        const eq = (c: string) => filters.find((f) => f.op === "eq" && f.col === c)?.val;
        let rows = [...(fx[table] ?? [])];
        if (table === "profiles") {
          const inId = filters.find((f) => f.op === "in" && f.col === "id")?.val as string[] | undefined;
          if (inId) rows = rows.filter((r) => inId.includes(r.id as string));
        }
        if (table === "commissions") {
          const own = eq("deal.assigned_to");
          const split = filters.find((f) => f.op === "contains" && f.col === "splits");
          if (own !== undefined) {
            commissionQueries.push({ kind: "own-deal", viewer: own });
            rows = rows.filter((r) => (r.deal as { assigned_to: string }).assigned_to === own);
          } else if (split) {
            const pid = (split.val as { profile_id: string }[])[0].profile_id;
            commissionQueries.push({ kind: "own-split", viewer: pid });
            rows = rows.filter((r) => ((r.splits as { profile_id?: string }[] | null) ?? []).some((s) => s.profile_id === pid));
          } else {
            commissionQueries.push({ kind: "all" });
          }
        }
        for (const col of ["assigned_to", "created_by", "handled_by"]) {
          const v = eq(col);
          if (v !== undefined) rows = rows.filter((r) => r[col] === v);
        }
        if (head) return resolve({ data: null, error: null, count: rows.length });
        return resolve({ data: rows, error: null, count: rows.length });
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, commissionQueries };
}

const permsOf = (role: AppRole) => DEFAULT_MATRIX[role] as EffectivePermissions;
const NOW = Date.parse("2026-03-15T09:00:00Z");
const PERIOD = trMonthPeriod(2026, 2); // Mart 2026

const profiles = [
  { id: "u1", full_name: "Ayşe Yılmaz", role: "advisor", branch_id: null },
  { id: "u2", full_name: "Can Demir", role: "advisor", branch_id: null },
  { id: "o1", full_name: "Ofis Sahibi", role: "owner", branch_id: null },
];

const fixture: Fixture = {
  profiles,
  customers: [
    { assigned_to: "u1", created_at: "2026-03-02T10:00:00Z" },
    { assigned_to: "u1", created_at: "2026-01-02T10:00:00Z" },
    { assigned_to: "u2", created_at: "2026-03-05T10:00:00Z" },
  ],
  calls: [{ handled_by: "u1" }, { handled_by: "u1" }, { handled_by: "u2" }],
  appointments: [{ assigned_to: "u1" }, { assigned_to: "u2" }, { assigned_to: "u2" }],
  offers: [
    { created_by: "u1", status: "accepted" },
    { created_by: "u1", status: "draft" },
    { created_by: "u2", status: "accepted" },
  ],
  properties: [{ assigned_to: "u1" }],
  commissions: [
    {
      id: "c1", gross_amount: 1000, status: "paid", created_at: "2026-03-10T10:00:00Z",
      splits: [{ label: "Danışman", rate: 40 }], deal: { assigned_to: "u1" },
    },
    {
      id: "c2", gross_amount: 2000, status: "collected", created_at: "2026-03-11T10:00:00Z",
      splits: [{ label: "Danışman", rate: 50 }], deal: { assigned_to: "u2" },
    },
    {
      id: "c3", gross_amount: 4000, status: "calculated", created_at: "2026-03-12T10:00:00Z",
      splits: [{ label: "Danışman", rate: 50 }], deal: { assigned_to: "u1" },
    },
  ],
  targets: [],
};

const owner = { userId: "o1", role: "owner", perms: permsOf("owner") };
const advisor1 = { userId: "u1", role: "advisor", perms: permsOf("advisor") };

describe("dönem sınırları (TR takvimi)", () => {
  it("ay [başlangıç, bitiş) Türkiye gece yarısıyla; ayın ilk 3 saati önceki aya yazılmaz", () => {
    expect(PERIOD.startIso).toBe("2026-02-28T21:00:00.000Z");
    expect(PERIOD.endIso).toBe("2026-03-31T21:00:00.000Z");
    expect(PERIOD.startDateKey).toBe("2026-03-01");
    // 2026-07-31T22:30Z = 1 Ağustos 01:30 TR
    expect(currentMonthPeriod(Date.parse("2026-07-31T22:30:00Z")).startDateKey).toBe("2026-08-01");
    expect(currentMonthPeriod(Date.parse("2026-07-31T22:30:00Z"), -1).startDateKey).toBe("2026-07-01");
    expect(trYearPeriod(2026).startIso).toBe("2025-12-31T21:00:00.000Z");
  });
});

describe("loadAdvisorMetrics: tek kaynak", () => {
  it("ofis geneli rol tüm ekibi görür; gelir = tahsil edilen komisyon PAYI, ofis komisyonu (brüt) ayrı", async () => {
    const { client } = fakeClient(fixture);
    const res = await loadAdvisorMetrics(client, { viewer: owner, tenantId: "t1", period: PERIOD, nowMs: NOW });
    expect(res.scope).toBe("office");
    const u1 = res.rows.find((r) => r.id === "u1")!;
    const u2 = res.rows.find((r) => r.id === "u2")!;
    expect(u1.revenue).toBe(400); // 1000 * %40 (paid); 4000 bekleyen sayılmaz
    expect(u1.pendingRevenue).toBe(2000);
    expect(u2.revenue).toBe(1000);
    expect(u1.offerCount).toBe(2);
    expect(u1.dealCount).toBe(1);
    expect(u1.conversionPct).toBe(50);
    expect(u1.callCount).toBe(2);
    expect(u1.newCustomerCount).toBe(2);
    expect(res.totals.revenue).toBe(1400);
    // Ofis komisyonu (brüt): paid + collected brüt, danışman paylarının toplamı DEĞİL
    expect(res.office.commissionGrossCollected).toBe(3000);
    expect(res.office.commissionGrossPending).toBe(4000);
  });

  it("aynı girdiyle sayfalar arası tutarlılık: ekip listesi, tek kişi (360), Kazanç ve Hedefler aynı geliri verir", async () => {
    const { client } = fakeClient(fixture);
    const team = await loadAdvisorMetrics(client, { viewer: owner, tenantId: "t1", period: PERIOD, nowMs: NOW });
    const single = await loadAdvisorMetrics(client, { viewer: owner, tenantId: "t1", period: PERIOD, nowMs: NOW, subjectIds: ["u1"] });
    const t1 = team.rows.find((r) => r.id === "u1")!;
    const s1 = single.rows[0];
    expect(s1).toEqual({ ...t1 }); // Kıyas / KPI / Lig satırı ile 360 özeti birebir aynı

    // Kazanç sayfası: aynı komisyon satırları, aynı pay hesabı
    const earn = earningInRange(
      fixture.commissions as never,
      PERIOD,
      "Ayşe Yılmaz",
      "u1",
      {},
    );
    expect(earn.collected).toBe(t1.revenue);
    expect(earn.pending).toBe(t1.pendingRevenue);

    // Hedefler: kişi hedefinin gerçekleşen geliri/anlaşması aynı tanım
    const actuals = await loadTargetActualsLive(client, {
      viewer: owner,
      tenantId: "t1",
      targets: [
        { id: "tg1", period: "monthly", period_start: "2026-03-01", profile_id: "u1" },
        { id: "tg0", period: "monthly", period_start: "2026-03-01", profile_id: null },
      ],
      names: new Map([["u1", "Ayşe Yılmaz"]]),
    });
    // sahte offers tablosunda created_at yok: anlaşma sayısı hedef tarafında zaman filtresiyle 0 olabilir; gelir aynı olmalı
    expect(actuals.get("tg1")!.revenue).toBe(t1.revenue);
    expect(actuals.get("tg0")!.revenue).toBe(team.office.commissionGrossCollected); // ofis hedefi = Ofis komisyonu (brüt)
  });

  it("ofis geneli kapsamı olmayan rol yalnız kendini görür (başkasının satırı listelenmez)", async () => {
    const { client } = fakeClient(fixture);
    const res = await loadAdvisorMetrics(client, { viewer: advisor1, tenantId: "t1", period: PERIOD, nowMs: NOW });
    expect(res.scope).toBe("self");
    expect(res.rows.map((r) => r.id)).toEqual(["u1"]);
    // subjectIds ile başkasını istese bile kapsam dışıdır
    const other = await loadAdvisorMetrics(client, { viewer: advisor1, tenantId: "t1", period: PERIOD, nowMs: NOW, subjectIds: ["u2"] });
    expect(other.rows).toEqual([]);
  });

  it("earnings_all yoksa başkasının komisyon satırı sunucudan HİÇ çekilmez ve başkasının geliri null döner", async () => {
    const { client, commissionQueries } = fakeClient(fixture);
    const res = await loadAdvisorMetrics(client, { viewer: advisor1, tenantId: "t1", period: PERIOD, nowMs: NOW });
    expect(commissionQueries.length).toBeGreaterThan(0);
    expect(commissionQueries.every((q) => q.kind !== "all")).toBe(true);
    expect(commissionQueries.every((q) => q.viewer === "u1")).toBe(true);
    expect(res.seeAllEarnings).toBe(false);
    expect(res.rows[0].revenue).toBe(400); // kendi geliri her zaman
    expect(res.office.commissionGrossCollected).toBeNull();
    expect(res.office.commissionGrossPending).toBeNull();

    // Yönetici (earnings_all yok: şube müdürü) tüm ekibi listeler ama yalnız kendi gelirini görür
    const bm = { userId: "u2", role: "branch_manager", perms: permsOf("branch_manager") };
    const bmRes = await loadAdvisorMetrics(client, { viewer: bm, tenantId: "t1", period: PERIOD, nowMs: NOW });
    expect(bmRes.scope).toBe("office");
    expect(bmRes.rows.find((r) => r.id === "u1")!.revenue).toBeNull();
    expect(bmRes.rows.find((r) => r.id === "u1")!.pendingRevenue).toBeNull();
    expect(bmRes.rows.find((r) => r.id === "u2")!.revenue).toBe(1000);
    expect(bmRes.totals.revenue).toBe(1000);
    expect(bmRes.office.commissionGrossCollected).toBeNull();
  });

  it("earnings_all olan rol komisyon satırlarını tek (filtresiz) sorguyla okur", async () => {
    const { client, commissionQueries } = fakeClient(fixture);
    await loadAdvisorMetrics(client, { viewer: owner, tenantId: "t1", period: PERIOD, nowMs: NOW });
    expect(commissionQueries).toEqual([{ kind: "all" }]);
  });
});

describe("buildAdvisorMetrics (saf)", () => {
  const facts: MetricsFacts = {
    profiles,
    customerTotals: new Map([["u1", 5]]),
    newCustomerOwners: [],
    liveProperties: new Map([["u1", 2]]),
    callHandlers: ["u1"],
    appointmentOwners: [],
    offers: [{ created_by: "u1", status: "accepted" }],
    commissions: fixture.commissions as never,
    targets: [{ profile_id: "u1", target_deals: 2, target_revenue: 1000 }],
    leadSignals: null,
  };

  it("hedef gerçekleşme: gelir görünüyorsa anlaşma ve gelir oranından yüksek olan, görünmüyorsa yalnız anlaşma", () => {
    const withRev = buildAdvisorMetrics(facts, { period: PERIOD, seeAllEarnings: true, viewerId: "o1", nowMs: NOW });
    const u1 = withRev.rows.find((r) => r.id === "u1")!;
    expect(u1.targetPct).toBe(50); // anlaşma 1/2 = %50; gelir 400/1000 = %40
    const hidden = buildAdvisorMetrics(facts, { period: PERIOD, seeAllEarnings: false, viewerId: "o1", nowMs: NOW });
    const h1 = hidden.rows.find((r) => r.id === "u1")!;
    expect(h1.revenue).toBeNull();
    expect(h1.targetPct).toBe(50);
  });

  it("görünmeyen kişinin payı hesaplanmaz ve toplam gelire girmez", () => {
    const out = buildAdvisorMetrics(facts, { period: PERIOD, seeAllEarnings: false, viewerId: "u2", nowMs: NOW });
    expect(out.rows.find((r) => r.id === "u1")!.commissionCount).toBeNull();
    expect(out.totals.revenue).toBe(summarizeAdvisorEarning(fixture.commissions as never, "Can Demir", "u2").collected);
  });
});
