import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockResolver, type RecordedQuery } from "../../test/supabase-mock";

/**
 * DAVRANIŞ TESTİ (B163): yayın kapısı — tekil, toplu ve portal yolları aynı kuralı kullanır (il + ilçe + TAMAMLANMIŞ
 * ilan sahibi kaydı; kayıt yoksa da engel). Toplu yayın ilk engelde durmaz: geçenler uygulanır, takılanlar nedenle
 * döner ({applied, blocked}). 50 ilanlık kapı denetimi ≤3 sorgu. DB kopyası (RPC 'publish_blocked') pglite testinde.
 */
const requirePermission = vi.fn();
let resolver: MockResolver = () => undefined;
let mock = createSupabaseMock((q) => resolver(q));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/oversight/approval-gate", () => ({ requestApprovalIfNeeded: vi.fn(async () => ({ status: "not_required" })) }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mock.client }));
// CRM-G5: toplu yayın sonrası yeniden eşleştirme yanıt SONRASI (after) çalışır; burada yalnız çağrı kaydedilir.
const afterSafe = vi.fn();
vi.mock("@/lib/after-safe", () => ({ afterSafe: (...a: unknown[]) => afterSafe(...a) }));
vi.mock("@/lib/match-notify", () => ({ notifyMatchesForPublishedProperties: vi.fn() }));

const { bulkUpdatePropertyStatus } = await import("./bulk-property");
const { publishBlockReason, publishBlockReasons } = await import("@/lib/property-owner/server");

const allow = { ok: true, tenantId: "t1", userId: "u1", role: "owner" };
const GEO = { province_id: "pv", district_id: "ds" };
const OWNER_OK = {
  customer_id: "c1",
  relation: "malik",
  deed_status: "kat_mulkiyeti",
  listing_source: "Saha / tabela",
  kvkk_consent: true,
  customer: { full_name: "Malik", phone: "05321234567", email: null },
};

type Fixture = { props: Record<string, unknown>[]; owners: Record<string, unknown>[]; pooled?: string[] };
function gateResolver(f: Fixture, rpc?: Record<string, unknown>): MockResolver {
  return (q: RecordedQuery) => {
    if (q.table === "listing_pool_entries") return { data: (f.pooled ?? []).map((property_id) => ({ property_id })) };
    if (q.table === "properties") return { data: f.props };
    if (q.table === "property_owner_info") return { data: f.owners };
    if (q.table === "rpc:transition_property_status_atomic") return { data: rpc ?? { outcome: "applied", updated_count: 1 } };
    return undefined;
  };
}
const prop = (id: string, over: Record<string, unknown> = {}) => ({ id, property_code: `ES-${id}`, ...GEO, authorization_type: "open", ...over });
const owner = (id: string, over: Record<string, unknown> = {}) => ({ property_id: id, ...OWNER_OK, ...over });

describe("publishBlockReasons (tek kural)", () => {
  beforeEach(() => {
    mock = createSupabaseMock((q) => resolver(q));
  });

  it("konumu ya da sahibi olmayan portföy engellenir; kayıt yoksa da (eski 'kapı yok' açığı kapandı)", async () => {
    resolver = gateResolver({
      props: [prop("a"), prop("b", { district_id: null }), prop("c"), prop("d"), prop("e")],
      owners: [owner("a"), owner("b"), owner("d", { kvkk_consent: false }), owner("e", { customer: null })],
    });
    const r = await publishBlockReasons(mock.client as never, "t1", ["a", "b", "c", "d", "e"]);
    expect(r.has("a")).toBe(false);
    expect(r.get("b")?.reason).toMatch(/Konum eksik/);
    expect(r.get("c")?.reason).toMatch(/İlan sahibi kaydı yok/);
    expect(r.get("d")?.reason).toMatch(/KVKK/);
    // Müşteri görünmüyorsa (kapsam dışı) telefon var sayılmaz: tutucu.
    expect(r.get("e")?.reason).toMatch(/telefonu/);
    expect(r.get("b")?.label).toBe("ES-b");
  });

  it("havuzda bekleyen ilan yayınlanamaz; sorgu hatasında kapı kapalı kalır", async () => {
    resolver = gateResolver({ props: [prop("a")], owners: [owner("a")], pooled: ["a"] });
    expect(await publishBlockReason(mock.client as never, "t1", "a")).toMatch(/havuzda/);
    resolver = (q) => (q.table === "properties" ? { error: { code: "57014", message: "timeout" } } : undefined);
    expect(await publishBlockReason(mock.client as never, "t1", "a")).toMatch(/denetlenemedi/);
  });

  it("50 ilanlık kapı ≤3 sorgu (ilan başına ardışık tur yok) ve hepsi tenant süzgeçli", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
    resolver = gateResolver({ props: ids.map((id) => prop(id)), owners: ids.map((id) => owner(id)) });
    const r = await publishBlockReasons(mock.client as never, "t1", ids);
    expect(r.size).toBe(0);
    expect(mock.queries.length).toBeLessThanOrEqual(3);
    for (const q of mock.queries) expect(q.filters.some((f) => f.method === "eq" && f.args[0] === "tenant_id" && f.args[1] === "t1")).toBe(true);
  });
});

describe("bulkUpdatePropertyStatus: kısmi sonuç", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    requirePermission.mockResolvedValue(allow);
    mock = createSupabaseMock((q) => resolver(q));
  });

  it("geçenler uygulanır, takılanlar {blocked} ile döner; RPC yalnız geçenlerle çağrılır", async () => {
    resolver = gateResolver({ props: [prop("a"), prop("b", { province_id: null })], owners: [owner("a"), owner("b")] });
    const res = await bulkUpdatePropertyStatus(["a", "b"], "live");
    expect(res.ok).toBe(true);
    expect(res.applied).toEqual(["a"]);
    expect(res.blocked).toEqual([{ id: "b", label: "ES-b", reason: expect.stringMatching(/Konum eksik/) }]);
    expect(res.error).toMatch(/1 portföy yayına alınamadı/);
    expect(mock.rpcCalls).toHaveLength(1);
    expect((mock.rpcCalls[0]!.args as { p_property_ids: string[] }).p_property_ids).toEqual(["a"]);
  });

  it("hepsi takılırsa RPC çağrılmaz", async () => {
    resolver = gateResolver({ props: [prop("a", { district_id: null })], owners: [] });
    const res = await bulkUpdatePropertyStatus(["a"], "live");
    expect(res.ok).toBeUndefined();
    expect(res.blocked).toHaveLength(1);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("DB kapısı (RPC publish_blocked) kullanıcıya açık hata döner", async () => {
    resolver = gateResolver({ props: [prop("a")], owners: [owner("a")] }, { outcome: "publish_blocked", blocked_ids: ["a"] });
    const res = await bulkUpdatePropertyStatus(["a"], "live");
    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/yayın koşullarını/);
  });

  it("'live' dışı durumda kapı sorgusu gitmez", async () => {
    resolver = gateResolver({ props: [], owners: [] });
    const res = await bulkUpdatePropertyStatus(["a"], "draft");
    expect(res.ok).toBe(true);
    expect(mock.forTable("property_owner_info")).toHaveLength(0);
  });
});
