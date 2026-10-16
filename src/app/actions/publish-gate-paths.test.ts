import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockResolver, type RecordedQuery } from "../../test/supabase-mock";

/**
 * DAVRANIŞ TESTİ (B163): tekil durum değişikliği ve portal yayını GERÇEK yayın kapısından (publishBlockReason) geçer:
 * konumu ya da tamamlanmış ilan sahibi kaydı olmayan portföy 'live' yapılamaz / portala gönderilemez. DB kapısı
 * ('publish_blocked') tekil yolda da sahip sekmesine yönlendirir. Toplu yol: bulk-property-publish-gate.test.ts;
 * RPC: src/lib/property-owner/publish-gate-sql-exec.test.ts.
 */
const requirePermission = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const publishToPortal = vi.fn();
let resolver: MockResolver = () => undefined;
let mock = createSupabaseMock((q) => resolver(q));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/assignment-notify", () => ({ idsDigest: vi.fn(() => "d"), notifyAssignment: vi.fn() }));
vi.mock("@/lib/automation-engine", () => ({ dispatchAutomationEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/playbook-trigger", () => ({ triggerPlaybooks: vi.fn(async () => undefined) }));
vi.mock("@/lib/integrations-api/webhooks", () => ({ emitWebhook: vi.fn() }));
vi.mock("@/lib/comparables", () => ({ resolvePriceHealth: vi.fn() }));
vi.mock("@/lib/match-notify", () => ({ notifyMatchingDemandsForProperty: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyTenant: vi.fn() }));
vi.mock("@/lib/matching", () => ({ fetchTenantMatchingWeights: vi.fn(), scoreDemandProperty: vi.fn() }));
vi.mock("@/lib/duplicate-finders", () => ({ findPropertyDuplicates: vi.fn(async () => []) }));
vi.mock("@/lib/geo/reader", () => ({ getDistrictName: vi.fn(), getProvinceName: vi.fn() }));
vi.mock("@/lib/property-owner/persist", () => ({ saveOwnerInfo: vi.fn() }));
vi.mock("@/lib/pool/server", () => ({ enqueueListingPool: vi.fn(), isPoolEnabled: vi.fn(async () => false), toPoolProperty: vi.fn() }));
vi.mock("@/lib/pool/system-assign", () => ({ assignPoolEntryAsSystem: vi.fn() }));
vi.mock("@/lib/pool/sources", () => ({ isIncomingPoolSource: vi.fn(() => false), parseIncomingPoolSource: vi.fn() }));
vi.mock("@/lib/pool/notify", () => ({ notifyNewListing: vi.fn(), notifyPoolAssigned: vi.fn(), notifyPoolEntry: vi.fn() }));
vi.mock("@/lib/oversight/approval-gate", () => ({ requestApprovalIfNeeded: vi.fn(async () => ({ status: "not_required" })) }));
vi.mock("@/lib/eids/authority-term", () => ({ shortAuthorityWarning: vi.fn() }));
vi.mock("@/lib/custom-fields/save", () => ({ prepareCustomFieldInputs: vi.fn(), writeCustomFieldInputs: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mock.client }));
vi.mock("@/lib/closed-listing-guard", () => ({ closedListingBlock: vi.fn(async () => null) }));
vi.mock("@/lib/eids/ledger", () => ({ authorityPublishGate: vi.fn(async () => ({ blocked: false, warning: undefined })) }));
vi.mock("@/lib/integrations/portals", () => ({
  publishToPortal: (...a: unknown[]) => publishToPortal(...a),
  updateOnPortal: vi.fn(),
  unpublishFromPortal: vi.fn(),
  isPortalConfigured: vi.fn(async () => true),
  getPortalConfigs: vi.fn(async () => []),
  isPortalSupported: vi.fn(() => true),
  SUPPORTED_PORTALS: ["sahibinden"],
}));

const { setPropertyStatus } = await import("./properties");
const { publishPropertyToPortal } = await import("./portal-publish");

const allow = { ok: true, tenantId: "t1", userId: "u1", role: "owner" };
const OWNER = {
  property_id: "p1",
  customer_id: "c1",
  relation: "malik",
  deed_status: "kat_mulkiyeti",
  listing_source: "Saha / tabela",
  kvkk_consent: true,
  customer: { full_name: "Malik", phone: "05321234567", email: null },
};
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
function world(opts: { geo: boolean; owner: boolean; rpc?: Record<string, unknown> }): MockResolver {
  return (q: RecordedQuery) => {
    if (q.table === "listing_pool_entries") return { data: [] };
    if (q.table === "properties") {
      const row = {
        id: "p1", property_code: "ES-1", title: "Villa", list_price: 850000, features: { currency: "USD" },
        province_id: opts.geo ? "pv" : null, district_id: opts.geo ? "ds" : null, authorization_type: "open",
      };
      // Portal yayınının tek kayıt okuması (maybeSingle) nesne, kapının toplu okuması dizi bekler.
      return { data: String(q.selectArgs?.[0] ?? "").includes("address_line") ? row : [row] };
    }
    if (q.table === "property_owner_info") return { data: opts.owner ? [OWNER] : [] };
    if (q.table === "rpc:transition_property_status_atomic") return { data: opts.rpc ?? { outcome: "applied", updated_count: 1 } };
    return { data: null };
  };
}

describe("yayın kapısı: tekil ve portal yolları", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    requirePermission.mockResolvedValue(allow);
    redirect.mockClear();
    publishToPortal.mockReset();
    publishToPortal.mockResolvedValue({ ok: true, externalId: "X1" });
    mock = createSupabaseMock((q) => resolver(q));
  });

  it("tekil: konumsuz portföy 'live' yapılamaz → sahip sekmesine yönlendirilir, RPC çağrılmaz", async () => {
    resolver = world({ geo: false, owner: true });
    await expect(setPropertyStatus(fd({ id: "p1", status: "live" }))).rejects.toThrow("REDIRECT:/app/portfoyler/p1?sekme=sahip&yayin=eksik");
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("tekil: sahip kaydı yoksa engellenir; tam kayıtta RPC çağrılır; DB kapısı da yönlendirir", async () => {
    resolver = world({ geo: true, owner: false });
    await expect(setPropertyStatus(fd({ id: "p1", status: "live" }))).rejects.toThrow(/REDIRECT/);
    resolver = world({ geo: true, owner: true });
    await setPropertyStatus(fd({ id: "p1", status: "live" }));
    expect(mock.rpcCalls.map((c) => c.name)).toEqual(["transition_property_status_atomic"]);
    resolver = world({ geo: true, owner: true, rpc: { outcome: "publish_blocked", blocked_ids: ["p1"] } });
    await expect(setPropertyStatus(fd({ id: "p1", status: "live" }))).rejects.toThrow(/sekme=sahip/);
  });

  it("tekil: sonuç döner — yetkisizlik ve RPC hatası sessiz kalmaz, başarı ok:true", async () => {
    resolver = world({ geo: true, owner: true });
    await expect(setPropertyStatus(fd({ id: "p1", status: "archived" }))).resolves.toEqual({ ok: true });
    resolver = world({ geo: true, owner: true, rpc: { outcome: "not_found" } });
    await expect(setPropertyStatus(fd({ id: "p1", status: "archived" }))).resolves.toMatchObject({ error: expect.stringMatching(/güncellenemedi/) });
    await expect(setPropertyStatus(fd({ id: "p1", status: "bogus" }))).resolves.toMatchObject({ error: expect.any(String) });
    requirePermission.mockResolvedValue({ ok: false, error: "Yetkiniz yok." });
    await expect(setPropertyStatus(fd({ id: "p1", status: "archived" }))).resolves.toEqual({ error: "Yetkiniz yok." });
  });

  it("portal: sahibi olmayan portföy portala gönderilmez; tam kayıtta para birimiyle gönderilir", async () => {
    resolver = world({ geo: true, owner: false });
    const blocked = await publishPropertyToPortal("p1", "sahibinden" as never);
    expect(blocked.error).toMatch(/İlan sahibi kaydı yok/);
    expect(publishToPortal).not.toHaveBeenCalled();

    resolver = world({ geo: true, owner: true });
    await publishPropertyToPortal("p1", "sahibinden" as never);
    expect(publishToPortal).toHaveBeenCalledTimes(1);
    expect(publishToPortal.mock.calls[0]![1]).toMatchObject({ listPrice: 850000, currency: "USD" });
  });
});
