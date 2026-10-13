import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Portal kuralları yönetim eylemleri: kapı (personel/rol), onayda bozuk içerik → yayın yok, geri alma sürümü artırır,
 * tohum yalnız set yokken, AI hız sınırı 2. çağrıda reddeder. DB, RPC'leri taklit eden bellek içi sahte istemcidir.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  staff: { id: "00000000-0000-4000-8000-0000000000aa", role: "super_admin" } as { id: string; role: string } | null,
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as { fn: string; args: Row }[],
  rateHits: new Map<string, number>(),
  applyResult: null as unknown,
  suggestCalls: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/platform", () => ({
  requirePlatformModule: async () => {
    if (!h.staff) throw new Error("NEXT_REDIRECT");
    return h.staff;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (key: string, opts: { limit: number }) => {
    const n = (h.rateHits.get(key) ?? 0) + 1;
    h.rateHits.set(key, n);
    return { allowed: n <= opts.limit };
  },
}));
vi.mock("@/lib/settings/read", () => ({ getSettings: async () => ({ "portal_rules.ai_min_tenants": 2 }) }));
vi.mock("@/lib/portal-transfer/rule-apply", () => ({
  applyProposals: (content: unknown) => h.applyResult ?? { ok: true, content, changeSummary: [{ kind: "label_map", field_key: "heating", added: ["isinma"] }] },
}));
vi.mock("@/lib/portal-rules/server/ai-suggest", () => ({
  suggestPortalRules: async () => {
    h.suggestCalls += 1;
    return { ok: true, inserted: 2 };
  },
}));

/** Zincirlenebilir, bellek içi PostgREST taklidi (eq/in/order/limit/maybeSingle/head count). */
function query(table: string) {
  let filters: ((r: Row) => boolean)[] = [];
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  let head = false;
  const exec = () => {
    let out = (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (order) {
      const { col, asc } = order;
      out = [...out].sort((a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1));
    }
    if (limit != null) out = out.slice(0, limit);
    return out;
  };
  const b = {
    select(_cols?: string, opts?: { head?: boolean }) {
      head = !!opts?.head;
      return b;
    },
    eq(col: string, v: unknown) {
      filters = [...filters, (r) => r[col] === v];
      return b;
    },
    in(col: string, vs: unknown[]) {
      filters = [...filters, (r) => vs.includes(r[col])];
      return b;
    },
    order(col: string, o?: { ascending?: boolean }) {
      order = { col, asc: o?.ascending !== false };
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    async maybeSingle() {
      return { data: exec()[0] ?? null, error: null };
    },
    then(resolve: (v: unknown) => unknown) {
      const rows = exec();
      return Promise.resolve(head ? { data: null, count: rows.length, error: null } : { data: rows, error: null }).then(resolve);
    },
  };
  return b;
}

function sets(portal: string) {
  return (h.tables.portal_rule_sets ?? []).filter((r) => r.portal === portal);
}

function publish(portal: string, content: Row, kind: string, extra: Row = {}) {
  const max = Math.max(0, ...sets(portal).map((r) => Number(r.version)));
  for (const r of sets(portal)) if (r.status === "published") r.status = "superseded";
  const row = { id: `00000000-0000-4000-8000-${String(max + 1).padStart(12, "0")}`, portal, version: max + 1, status: "published", kind, content: { ...content, version: max + 1 }, ...extra };
  (h.tables.portal_rule_sets ??= []).push(row);
  return row;
}

const db = {
  from: (t: string) => query(t),
  async rpc(fn: string, args: Row) {
    h.rpcCalls.push({ fn, args });
    if (fn === "pt_rules_admin_publish") {
      const row = publish(String(args.p_portal), args.p_content as Row, String(args.p_kind));
      return { data: { version: row.version }, error: null };
    }
    if (fn === "pt_rules_admin_rollback") {
      const target = sets(String(args.p_portal)).find((r) => r.version === args.p_to_version);
      if (!target) return { data: null, error: { message: "not found" } };
      const row = publish(String(args.p_portal), target.content as Row, "rollback", { rolls_back_to: target.version });
      return { data: { version: row.version }, error: null };
    }
    if (fn === "pt_rules_admin_decide") {
      const p = (h.tables.portal_rule_proposals ?? []).find((r) => r.id === args.p_proposal_id);
      if (p) p.state = args.p_decision;
      return { data: null, error: null };
    }
    return { data: null, error: null };
  },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

import { decideProposal, publishSeed, rollbackTo, runAiSuggest, setTenantTrust } from "./admin-portal-rules";
import { seedRuleSet } from "@/lib/portal-transfer/seed-rules";

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

function seedContent(version: number): Row {
  return { ...(seedRuleSet("sahibinden") as unknown as Row), version, issuedAt: "2026-10-13T00:00:00.000Z" };
}

beforeEach(() => {
  h.staff = { id: "00000000-0000-4000-8000-0000000000aa", role: "super_admin" };
  h.tables = {};
  h.rpcCalls = [];
  h.rateHits = new Map();
  h.applyResult = null;
  h.suggestCalls = 0;
});

describe("kapı", () => {
  it("personel olmayan kullanıcı her eylemde reddedilir (yazma yok)", async () => {
    h.staff = null;
    await expect(publishSeed("sahibinden")).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(rollbackTo("sahibinden", 1)).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(decideProposal({ proposalId: PROPOSAL_ID, decision: "reject", reason: "gerekçe" })).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(setTenantTrust({ tenantId: TENANT_ID, eligible: false, reason: "test ofisi" })).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(runAiSuggest("sahibinden")).rejects.toThrow(/NEXT_REDIRECT/);
    expect(h.rpcCalls).toEqual([]);
  });

  it("ops yayın üretemez (tohum/geri alma/onay yalnız süper admin), ret ve uygunluk yapabilir", async () => {
    h.staff = { id: "00000000-0000-4000-8000-0000000000bb", role: "ops" };
    expect((await publishSeed("sahibinden")).error).toMatch(/süper admin/);
    expect((await rollbackTo("sahibinden", 1)).error).toMatch(/süper admin/);
    expect((await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" })).error).toMatch(/süper admin/);
    expect(h.rpcCalls).toEqual([]);
    expect((await setTenantTrust({ tenantId: TENANT_ID, eligible: false, reason: "Demo ofisi" })).ok).toBe(true);
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(["pt_rules_admin_set_trust"]);
  });
});

describe("publishSeed", () => {
  it("set yokken tohumu sürüm 1 olarak yayınlar", async () => {
    const r = await publishSeed("sahibinden");
    expect(r.ok).toBe(true);
    expect(r.version).toBe(1);
    const call = h.rpcCalls.find((c) => c.fn === "pt_rules_admin_publish")!;
    expect(call.args).toMatchObject({ p_portal: "sahibinden", p_kind: "seed", p_parent: null });
    expect((call.args.p_content as Row).version).toBe(1);
  });

  it("set varken reddedilir ve RPC çağrılmaz", async () => {
    publish("sahibinden", seedContent(1), "seed");
    const r = await publishSeed("sahibinden");
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/zaten kural seti var/);
    expect(h.rpcCalls).toEqual([]);
  });

  it("geçersiz portal reddedilir", async () => {
    expect((await publishSeed("zingat")).error).toMatch(/Geçersiz portal/);
  });
});

describe("decideProposal", () => {
  function withProposal(extra: Row = {}) {
    publish("sahibinden", seedContent(1), "seed");
    h.tables.portal_rule_proposals = [
      { id: PROPOSAL_ID, portal: "sahibinden", kind: "label_map", field_key: "heating", proposal: { label: "isinma" }, source: "corrections", support_tenants: 3, state: "ready", ...extra },
    ];
  }

  it("onay yayındaki içeriğe uygular, doğrular ve sürüm 2 yayınlar; öneri approved olur", async () => {
    withProposal();
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" });
    expect(r.ok).toBe(true);
    expect(r.version).toBe(2);
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(["pt_rules_admin_publish", "pt_rules_admin_decide"]);
    expect(h.rpcCalls[0].args).toMatchObject({ p_kind: "staff", p_portal: "sahibinden" });
    expect(h.rpcCalls[1].args).toMatchObject({ p_decision: "approved" });
  });

  it("onay bozuk içerik üretirse yayın yapılmaz ve hata gösterilir", async () => {
    withProposal();
    h.applyResult = { ok: true, content: { bozuk: true }, changeSummary: [] };
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" });
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/yayın yapılmadı/);
    expect(h.rpcCalls).toEqual([]);
    expect(sets("sahibinden")).toHaveLength(1);
  });

  it("applyProposals hata dönerse yayın yapılmaz", async () => {
    withProposal();
    h.applyResult = { ok: false, reason: "too_many_changes" };
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" });
    expect(r.error).toMatch(/too_many_changes/);
    expect(h.rpcCalls).toEqual([]);
  });

  it("tek ofisten gelen metin önerisi kişisel veri teyidi olmadan onaylanmaz", async () => {
    withProposal({ support_tenants: 1 });
    expect((await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" })).error).toMatch(/kişisel veri/);
    expect(h.rpcCalls).toEqual([]);
    expect((await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve", noPersonalData: true })).ok).toBe(true);
  });

  it("ret gerekçe ister", async () => {
    withProposal();
    expect((await decideProposal({ proposalId: PROPOSAL_ID, decision: "reject", reason: " " })).error).toMatch(/gerekçe/);
    expect(h.rpcCalls).toEqual([]);
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "reject", reason: "Yanlış eşleme" });
    expect(r.ok).toBe(true);
    expect(h.rpcCalls[0]).toMatchObject({ fn: "pt_rules_admin_decide", args: { p_decision: "rejected", p_reason: "Yanlış eşleme" } });
  });
});

describe("rollbackTo", () => {
  it("geri alma eski içerikle sürümü artırır (v1, v2 → v3 = v1 içeriği)", async () => {
    publish("sahibinden", seedContent(1), "seed");
    publish("sahibinden", seedContent(2), "staff");
    const r = await rollbackTo("sahibinden", 1);
    expect(r.ok).toBe(true);
    expect(r.version).toBe(3);
    const v3 = sets("sahibinden").find((s) => s.version === 3)!;
    expect(v3).toMatchObject({ kind: "rollback", rolls_back_to: 1, status: "published" });
  });

  it("yayındaki sürüme geri dönülmez; olmayan sürüm reddedilir", async () => {
    publish("sahibinden", seedContent(1), "seed");
    expect((await rollbackTo("sahibinden", 1)).error).toMatch(/zaten yayında/);
    expect((await rollbackTo("sahibinden", 9)).error).toMatch(/bulunamadı/);
    expect(h.rpcCalls).toEqual([]);
  });

  it("hedef içerik bugünkü doğrulamadan geçmezse geri alma yapılmaz", async () => {
    publish("sahibinden", seedContent(1), "seed");
    (h.tables.portal_rule_sets ??= []).push({ id: "x", portal: "sahibinden", version: 2, status: "superseded", kind: "staff", content: { bozuk: true } });
    publish("sahibinden", seedContent(3), "staff");
    expect((await rollbackTo("sahibinden", 2)).error).toMatch(/doğrulamadan geçmiyor/);
    expect(h.rpcCalls).toEqual([]);
  });
});

describe("runAiSuggest", () => {
  it("portal başına hız sınırı: 2. çağrı reddedilir ve öneri üretilmez", async () => {
    const first = await runAiSuggest("sahibinden");
    expect(first.ok).toBe(true);
    const second = await runAiSuggest("sahibinden");
    expect(second.ok).toBeUndefined();
    expect(second.error).toMatch(/10 dakikada/);
    expect(h.suggestCalls).toBe(1);
    expect([...h.rateHits.keys()]).toEqual(["pt-ai:sahibinden"]);
  });
});
