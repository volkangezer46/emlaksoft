import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: () => { throw new Error("oturum istemcisi bu testte kullanılmamalı"); } })) }));

import { countInsightsByState, getInsightsForUser, roleReceivesInsights } from "@/lib/insights/read";

const U1 = "11111111-1111-4111-8111-111111111111";
const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  kind: "call_priority",
  rule_id: "call_priority@1",
  severity: "orta",
  priority: 50,
  title: "T",
  why: "W",
  evidence: [],
  href: "/app/musteriler/c1",
  entity_type: "customer",
  entity_id: "c1",
  is_forecast: false,
  confidence: null,
  state: "new",
  snoozed_until: null,
  valid_until: future(),
  created_at: new Date().toISOString(),
  narrative: null,
  narrative_source: "rule",
  ...over,
});

/** Sorgu parametrelerini kaydeden sahte istemci. */
function fakeClient(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  const seen: { eq: [string, unknown][]; inCol: [string, unknown][] } = { eq: [], inCol: [] };
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (c: string, v: unknown) => (seen.eq.push([c, v]), q);
  q.in = (c: string, v: unknown) => (seen.inCol.push([c, v]), q);
  q.gt = () => q;
  q.order = () => q;
  q.limit = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: result.data ?? null, error: result.error ?? null });
  return { client: { from: () => q } as unknown as SupabaseClient, seen };
}

describe("getInsightsForUser (tipli okuyucu)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("alıcıya ve ofise açıkça daraltır (owner/gm RLS'e güvenmez) ve tipli sonuç döner", async () => {
    const { client, seen } = fakeClient({ data: [dbRow({ id: "a", priority: 20 }), dbRow({ id: "b", priority: 80 })] });
    const out = await getInsightsForUser({ tenantId: "t1", userId: U1, role: "owner", limit: 8, client });
    expect(out.map((i) => i.id)).toEqual(["b", "a"]);
    expect(out[0].ruleId).toBe("call_priority@1");
    expect(seen.eq).toContainEqual(["tenant_id", "t1"]);
    expect(seen.eq).toContainEqual(["recipient_user_id", U1]);
    expect(seen.inCol).toContainEqual(["state", ["new", "seen", "snoozed"]]);
  });

  it("SÜRESİ GEÇEN ve kapanan satırlar okunmaz (sorgu atlasa bile ikinci savunma)", async () => {
    const { client } = fakeClient({
      data: [dbRow({ id: "old", valid_until: past() }), dbRow({ id: "dis", state: "dismissed" }), dbRow({ id: "ok" })],
    });
    const out = await getInsightsForUser({ tenantId: "t1", userId: U1, role: "advisor", client });
    expect(out.map((i) => i.id)).toEqual(["ok"]);
  });

  it("hata, tablo yok, boş veri = boş dizi; ASLA fırlatmaz", async () => {
    const missing = fakeClient({ error: { code: "42P01", message: 'relation "insights" does not exist' } });
    await expect(getInsightsForUser({ tenantId: "t1", userId: U1, role: "advisor", client: missing.client })).resolves.toEqual([]);
    const boom = { from: () => { throw new Error("patladı"); } } as unknown as SupabaseClient;
    await expect(getInsightsForUser({ tenantId: "t1", userId: U1, role: "advisor", client: boom })).resolves.toEqual([]);
    const empty = fakeClient({ data: [] });
    await expect(getInsightsForUser({ tenantId: "t1", userId: U1, role: "advisor", client: empty.client })).resolves.toEqual([]);
  });

  it("readonly rolü içgörü almaz; eksik kimlik boş döner", async () => {
    const { client } = fakeClient({ data: [dbRow()] });
    expect(roleReceivesInsights("readonly")).toBe(false);
    expect(await getInsightsForUser({ tenantId: "t1", userId: U1, role: "readonly", client })).toEqual([]);
    expect(await getInsightsForUser({ tenantId: "", userId: U1, role: "advisor", client })).toEqual([]);
  });

  it("limit en çok 50", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => dbRow({ id: `r${i}`, priority: i }));
    const { client } = fakeClient({ data: rows });
    const out = await getInsightsForUser({ tenantId: "t1", userId: U1, role: "advisor", limit: 500, client });
    expect(out).toHaveLength(50);
  });
});

describe("countInsightsByState", () => {
  it("durumlara göre sayar; hata sıfır döner", async () => {
    const { client } = fakeClient({
      data: [
        { state: "new", snoozed_until: null, valid_until: future() },
        { state: "new", snoozed_until: null, valid_until: future() },
        { state: "seen", snoozed_until: null, valid_until: future() },
        { state: "bilinmeyen", snoozed_until: null, valid_until: future() },
      ],
    });
    const c = await countInsightsByState({ tenantId: "t1", userId: U1, role: "advisor", client });
    expect(c).toEqual({ new: 2, seen: 1, snoozed: 0, dismissed: 0, accepted: 0 });
    const bad = fakeClient({ error: { code: "XX" } });
    const z = await countInsightsByState({ tenantId: "t1", userId: U1, role: "advisor", client: bad.client });
    expect(Object.values(z).every((n) => n === 0)).toBe(true);
  });
});
