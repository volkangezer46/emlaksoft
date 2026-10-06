import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_OPEN_PER_USER,
  planInsightRows,
  processTenant,
  resolveRecipients,
  selectTenantBatch,
  shouldGenerateForTenant,
} from "@/lib/insights/engine";
import { suppressionKey } from "@/lib/insights/dedupe";
import { InsightFactsUnavailable } from "@/lib/insights/facts";
import type { InsightRule } from "@/lib/insights/rules";
import type { InsightDraft } from "@/lib/insights/types";

const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const GM = "44444444-4444-4444-8444-444444444444";
const RO = "55555555-5555-4555-8555-555555555555";

const recipients = [
  { id: U1, role: "advisor" },
  { id: U2, role: "advisor" },
  { id: OWNER, role: "owner" },
  { id: GM, role: "gm" },
];

const draft = (over: Partial<InsightDraft> = {}): InsightDraft => ({
  kind: "call_priority",
  ruleId: "call_priority@1",
  severity: "orta",
  title: "Ara",
  why: "Neden",
  evidence: [{ label: "Sessizlik", value: "20 gün" }],
  href: "/app/musteriler/c1",
  entityType: "customer",
  entityId: "c1",
  isForecast: false,
  confidence: null,
  dedupeKey: "call:c1:2026-10-05",
  validUntilMs: NOW + 7 * 86_400_000,
  audience: { type: "user", userId: U1 },
  ...over,
});

const plan = (drafts: InsightDraft[], over: Partial<Parameters<typeof planInsightRows>[0]> = {}) =>
  planInsightRows({
    tenantId: "t1",
    drafts,
    recipients,
    suppressed: new Set(),
    dismissalsByRule: new Map(),
    existingOpenKeys: new Map(),
    ...over,
  });

describe("shouldGenerateForTenant (örnek veri ofiste üretmez)", () => {
  it("gerçek müşteri ve portföy eşiğin (5) altındaysa üretmez", () => {
    expect(shouldGenerateForTenant({ realCustomers: 0, realProperties: 0 })).toBe(false);
    expect(shouldGenerateForTenant({ realCustomers: 4, realProperties: 4 })).toBe(false);
  });
  it("gerçek veri eşiğe ulaşınca üretir", () => {
    expect(shouldGenerateForTenant({ realCustomers: 5, realProperties: 0 })).toBe(true);
    expect(shouldGenerateForTenant({ realCustomers: 0, realProperties: 9 })).toBe(true);
  });
});

describe("resolveRecipients", () => {
  it("kullanıcı hedefi yalnız aktif alıcıysa çözülür; readonly/bilinmeyen düşer", () => {
    expect(resolveRecipients(draft(), recipients)).toEqual([U1]);
    expect(resolveRecipients(draft({ audience: { type: "user", userId: RO } }), recipients)).toEqual([]);
  });
  it("yönetim hedefi yalnız yönetim rollerine yayılır", () => {
    expect(resolveRecipients(draft({ audience: { type: "management" } }), recipients).sort()).toEqual([GM, OWNER].sort());
  });
});

describe("planInsightRows", () => {
  it("aynı alıcı + aynı anahtar bir kez planlanır (deterministik dedupe)", () => {
    const { rows } = plan([draft(), draft()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_user_id).toBe(U1);
    expect(rows[0].href).toBe("/app/musteriler/c1");
  });

  it("yoksay bastırması: ilgisiz/yanlış yoksayılan (alıcı, kural, kayıt) tekrar üretilmez", () => {
    const suppressed = new Set([suppressionKey(U1, "call_priority", "c1")]);
    expect(plan([draft()], { suppressed }).rows).toEqual([]);
    // Başka müşteri etkilenmez.
    expect(plan([draft({ entityId: "c2", dedupeKey: "call:c2:2026-10-05" })], { suppressed }).rows).toHaveLength(1);
  });

  it("zaten açık olan içgörü yeniden planlanmaz", () => {
    const existing = new Map([[U1, new Set(["call:c1:2026-10-05"])]]);
    expect(plan([draft()], { existingOpenKeys: existing }).rows).toEqual([]);
  });

  it("kullanıcı başına açık içgörü üst sınırı uygulanır ve öncelikli olanlar kalır", () => {
    const many = Array.from({ length: MAX_OPEN_PER_USER + 5 }, (_, i) =>
      draft({ entityId: `c${i}`, dedupeKey: `call:c${i}:w`, severity: i === 0 ? "yuksek" : "bilgi" }),
    );
    const { rows } = plan(many);
    expect(rows).toHaveLength(MAX_OPEN_PER_USER);
    expect(rows[0].severity).toBe("yuksek");
    // Mevcut açık sayısı kapasiteden düşer.
    const existing = new Map([[U1, new Set(Array.from({ length: MAX_OPEN_PER_USER - 2 }, (_, i) => `old:${i}`))]]);
    expect(plan(many, { existingOpenKeys: existing }).rows).toHaveLength(2);
  });

  it("öncelik yoksayma geçmişiyle azalır", () => {
    const base = plan([draft()]).rows[0].priority;
    const lowered = plan([draft()], { dismissalsByRule: new Map([["call_priority", 3]]) }).rows[0].priority;
    expect(lowered).toBeLessThan(base);
  });

  it("satır alanları şema kısıtlarına uyar (href '/' ile başlar, kanıt 8 satırı geçmez)", () => {
    const { rows } = plan([draft({ href: "javascript:alert(1)", evidence: Array.from({ length: 12 }, (_, i) => ({ label: `l${i}`, value: "v" })) })]);
    expect(rows[0].href.startsWith("/")).toBe(true);
    expect((rows[0].evidence as unknown[]).length).toBeLessThanOrEqual(8);
  });
});

describe("selectTenantBatch (imleç + bütçe)", () => {
  const ids = ["a", "b", "c", "d", "e"];
  it("imleçsiz baştan başlar, bütçe kadar ofis alır, kalan sayısı raporlar", () => {
    expect(selectTenantBatch(ids, null, 2)).toEqual({ batch: ["a", "b"], remainingAfter: 3, wrapsAround: false });
  });
  it("imleçten sonrasını alır; liste bitince başa sarar", () => {
    expect(selectTenantBatch(ids, "b", 2)).toEqual({ batch: ["c", "d"], remainingAfter: 1, wrapsAround: false });
    expect(selectTenantBatch(ids, "d", 5)).toEqual({ batch: ["e"], remainingAfter: 0, wrapsAround: true });
    expect(selectTenantBatch(ids, "e", 5)).toEqual({ batch: [], remainingAfter: 0, wrapsAround: true });
  });
});

/** Zincirleme çağrıları yutan, sayım dönen sahte istemci. */
function fakeAdmin(handlers: { count?: number; rows?: Record<string, unknown>; upsertRows?: unknown[] } = {}) {
  const calls: string[] = [];
  const chain = (table: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "gt", "gte", "order", "limit", "range", "maybeSingle", "update"]) {
      self[m] = () => self;
    }
    self.upsert = () => {
      calls.push(`upsert:${table}`);
      return self;
    };
    self.then = (resolve: (v: unknown) => unknown) =>
      resolve({
        data: table === "insights" && calls.includes("upsert:insights") ? (handlers.upsertRows ?? []) : (handlers.rows?.[table] ?? []),
        count: handlers.count ?? 0,
        error: null,
      });
    return self;
  };
  const admin = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return chain(table);
    },
    rpc: vi.fn(async (name: string) => {
      calls.push(`rpc:${name}`);
      return { data: [], error: null };
    }),
  };
  return { admin: admin as unknown as SupabaseClient, calls, rpc: admin.rpc };
}

describe("processTenant", () => {
  it("ÖRNEK VERİ ofisi atlanır: kural koşmaz, hiçbir insights yazımı olmaz", async () => {
    const { admin, calls, rpc } = fakeAdmin({ count: 2 });
    const run = vi.fn(async () => [draft()]);
    const rule: InsightRule = { id: "call_priority@1", kind: "call_priority", run };
    const r = await processTenant(admin, "t1", NOW, { rules: [rule] });
    expect(r.skipped).toBe("sample");
    expect(r.inserted).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(calls.some((c) => c === "upsert:insights")).toBe(false);
  });

  it("gerçek veri varsa kuralı koşar; RPC'si olmayan kural 'etkin değil' sayılır, diğerleri sürer", async () => {
    const { admin } = fakeAdmin({ count: 9, rows: { profiles: [{ id: U1, role: "advisor" }] } });
    const ok: InsightRule = { id: "call_priority@1", kind: "call_priority", run: async () => [draft()] };
    const missing: InsightRule = {
      id: "deal_risk@1",
      kind: "deal_risk",
      run: async () => {
        throw new InsightFactsUnavailable("insight_stalled_deals");
      },
    };
    const r = await processTenant(admin, "t1", NOW, { rules: [ok, missing] });
    expect(r.skipped).toBeNull();
    expect(r.rulesUnavailable).toEqual(["deal_risk@1"]);
  });

  it("ofis ayarıyla sessize alınan kural koşmaz; kalite bastırması da koşturmaz", async () => {
    const muted = fakeAdmin({
      count: 9,
      rows: {
        profiles: [{ id: U1, role: "advisor" }],
        oversight_settings: { thresholds: { insights: { mutedRules: ["call_priority"] } } },
      },
    });
    const run = vi.fn(async () => [draft()]);
    const rule: InsightRule = { id: "call_priority@1", kind: "call_priority", run };
    const r1 = await processTenant(muted.admin, "t1", NOW, { rules: [rule] });
    expect(run).not.toHaveBeenCalled();
    expect(r1.rulesMuted).toBe(1);

    // Yanlış alarm oranı yüksek (12 değerlendirme, 8 "yanlış" = %67) -> bastırılır.
    const noisy = fakeAdmin({
      count: 9,
      rows: {
        profiles: [{ id: U1, role: "advisor" }],
        insight_rule_quality: [{ rule_id: "call_priority@1", accepted: 2, dismissed: 10, dismissed_wrong: 8 }],
      },
    });
    const r2 = await processTenant(noisy.admin, "t1", NOW, { rules: [rule] });
    expect(run).not.toHaveBeenCalled();
    expect(r2.rulesMuted).toBe(1);

    // Ayar yoksa koşar.
    const plain = fakeAdmin({ count: 9, rows: { profiles: [{ id: U1, role: "advisor" }] } });
    await processTenant(plain.admin, "t1", NOW, { rules: [rule] });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
