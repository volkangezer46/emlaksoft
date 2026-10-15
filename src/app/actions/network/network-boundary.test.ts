import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, hasFilter, type MockResolver } from "../../../test/supabase-mock";

/**
 * DAVRANIŞ TESTİ: Ofisler Arası Ağ — yetki ve kiracı sınırı.
 * - yetki reddinde hiçbir sorgu gitmez,
 * - kendi tenant'ına ait olmayan kayıt id'leri (başka ofisin isteği/ilanı) reddedilir,
 * - duraklatılmış/kaldırılmış ilan ve talepler havuzda görünmez ve talep/yanıt kabul etmez,
 * - talebi/yanıtı yalnız gönderen ofis geri çekebilir.
 */
const requirePermission = vi.fn();
const logActivity = vi.fn(async () => ({ ok: true }));
const notifyTenant = vi.fn(async () => undefined);
let resolver: MockResolver = () => undefined;
let mock = createSupabaseMock((q) => resolver(q));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...(a as [])) }));
vi.mock("@/lib/notify", () => ({ notifyTenant: (...a: unknown[]) => notifyTenant(...(a as [])) }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mock.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mock.client }));

const allow = { ok: true, tenantId: "t1", userId: "u1", role: "owner" };
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  requirePermission.mockReset();
  requirePermission.mockResolvedValue(allow);
  logActivity.mockClear();
  notifyTenant.mockClear();
  resolver = () => undefined;
  mock = createSupabaseMock((q) => resolver(q));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("yetki reddi", () => {
  it("yazma ve okuma action'ları kapıda durur; sorgu gitmez", async () => {
    requirePermission.mockResolvedValue({ ok: false, error: "Yetkiniz yok." });
    const listings = await import("./listings");
    const collab = await import("./collab");
    const demands = await import("./demands");
    const queries = await import("./queries");

    expect(await listings.shareToNetwork({}, fd({ property_id: "p1", commission_share_pct: "10" }))).toEqual({ error: "Yetkiniz yok." });
    expect(await listings.pauseNetworkListing("l1")).toEqual({ error: "Yetkiniz yok." });
    expect(await collab.sendCollabRequest({}, fd({ listing_id: "l1", message: "Merhaba" }))).toEqual({ error: "Yetkiniz yok." });
    expect(await collab.withdrawRequest("r1")).toEqual({ error: "Yetkiniz yok." });
    expect(await demands.acceptDemandResponse("dr1")).toEqual({ error: "Yetkiniz yok." });
    expect(await queries.listNetworkPool()).toEqual([]);
    expect(await queries.listNetworkDemandPool()).toEqual([]);
    expect(mock.queries).toHaveLength(0);
  });
});

describe("portföy paylaşımı (listings)", () => {
  it("başka ofisin portföy id'si: tenant süzgeci yüzünden bulunmaz, paylaşım yazılmaz", async () => {
    resolver = () => ({ data: null });
    const { shareToNetwork } = await import("./listings");
    const res = await shareToNetwork({}, fd({ property_id: "foreign-prop", commission_share_pct: "10" }));
    expect(res).toEqual({ error: "Portföy bulunamadı." });
    const [lookup] = mock.forTable("properties");
    expect(hasFilter(lookup, "eq", "id", "foreign-prop")).toBe(true);
    expect(hasFilter(lookup, "eq", "tenant_id", "t1")).toBe(true);
    expect(mock.forTable("network_listings", "upsert")).toHaveLength(0);
  });

  it("duraklatma/kaldırma yalnız kendi tenant'ının satırına yazılır", async () => {
    const { pauseNetworkListing, removeFromNetwork } = await import("./listings");
    expect(await pauseNetworkListing("l1")).toEqual({ ok: true });
    expect(await removeFromNetwork("l1")).toEqual({ ok: true });
    const [upd] = mock.forTable("network_listings", "update");
    expect(upd.payload).toEqual({ status: "paused" });
    expect(hasFilter(upd, "eq", "tenant_id", "t1")).toBe(true);
    const [del] = mock.forTable("network_listings", "delete");
    expect(hasFilter(del, "eq", "id", "l1")).toBe(true);
    expect(hasFilter(del, "eq", "tenant_id", "t1")).toBe(true);
  });
});

describe("iş birliği talepleri (collab)", () => {
  it("duraklatılmış ilana talep gönderilemez", async () => {
    resolver = (q) =>
      q.table === "network_listings" ? { data: { id: "l1", tenant_id: "t2", status: "paused" } } : undefined;
    const { sendCollabRequest } = await import("./collab");
    const res = await sendCollabRequest({}, fd({ listing_id: "l1", message: "Merhaba" }));
    expect(res).toEqual({ error: "İlan artık ağda aktif değil." });
    expect(mock.forTable("network_requests", "insert")).toHaveLength(0);
    expect(notifyTenant).not.toHaveBeenCalled();
  });

  it("ağdan kaldırılmış (silinmiş) ilana talep gönderilemez", async () => {
    resolver = () => ({ data: null });
    const { sendCollabRequest } = await import("./collab");
    const res = await sendCollabRequest({}, fd({ listing_id: "gone", message: "Merhaba" }));
    expect(res).toEqual({ error: "İlan artık ağda aktif değil." });
    expect(mock.forTable("network_requests", "insert")).toHaveLength(0);
  });

  it("kendi ilanına talep gönderilemez", async () => {
    resolver = (q) =>
      q.table === "network_listings" ? { data: { id: "l1", tenant_id: "t1", status: "active" } } : undefined;
    const { sendCollabRequest } = await import("./collab");
    const res = await sendCollabRequest({}, fd({ listing_id: "l1", message: "Merhaba" }));
    expect(res).toEqual({ error: "Kendi ilanınıza talep gönderemezsiniz." });
    expect(mock.forTable("network_requests", "insert")).toHaveLength(0);
  });

  it("aktif yabancı ilana talep: from=kendi tenant, to=ilan sahibi", async () => {
    resolver = (q) => {
      if (q.table === "network_listings") return { data: { id: "l1", tenant_id: "t2", status: "active" } };
      if (q.table === "network_requests" && q.op === "select") return { count: 0 };
      if (q.table === "network_requests" && q.op === "insert") return { data: { id: "r1" } };
      return undefined;
    };
    const { sendCollabRequest } = await import("./collab");
    const res = await sendCollabRequest({}, fd({ listing_id: "l1", message: "Merhaba" }));
    expect(res).toEqual({ ok: true, id: "r1" });
    const [ins] = mock.forTable("network_requests", "insert");
    expect(ins.payload).toMatchObject({ listing_id: "l1", from_tenant_id: "t1", to_tenant_id: "t2" });
    expect(notifyTenant).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t2" }));
  });

  it("başka ofise gelen talep yanıtlanamaz (to_tenant_id süzgeci); güncelleme gitmez", async () => {
    resolver = () => ({ data: null });
    const { respondCollabRequest } = await import("./collab");
    const res = await respondCollabRequest("foreign-req", "accept");
    expect(res).toEqual({ error: "Talep bulunamadı." });
    const [lookup] = mock.forTable("network_requests", "select");
    expect(hasFilter(lookup, "eq", "id", "foreign-req")).toBe(true);
    expect(hasFilter(lookup, "eq", "to_tenant_id", "t1")).toBe(true);
    expect(mock.forTable("network_requests", "update")).toHaveLength(0);
    expect(notifyTenant).not.toHaveBeenCalled();
  });

  it("geri çekme yalnız gönderen ofisin bekleyen talebine yazılır", async () => {
    resolver = (q) => (q.table === "network_requests" && q.op === "update" ? { data: [{ id: "r1" }] } : undefined);
    const { withdrawRequest } = await import("./collab");
    expect(await withdrawRequest("r1")).toEqual({ ok: true });
    const [upd] = mock.forTable("network_requests", "update");
    expect(upd.payload).toEqual({ status: "withdrawn" });
    expect(hasFilter(upd, "eq", "id", "r1")).toBe(true);
    expect(hasFilter(upd, "eq", "from_tenant_id", "t1")).toBe(true);
    expect(hasFilter(upd, "eq", "status", "pending")).toBe(true);
  });

  it("talep sahibi olmayan ofis geri çekemez: eşleşen satır yoksa hata, denetim kaydı yazılmaz", async () => {
    resolver = () => ({ data: [] });
    const { withdrawRequest } = await import("./collab");
    const res = await withdrawRequest("someone-elses");
    expect(res).toEqual({ error: "Yalnız bekleyen talepler geri çekilebilir." });
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("talep havuzu (demands)", () => {
  it("duraklatılmış ağ talebine yanıt verilemez", async () => {
    resolver = (q) =>
      q.table === "network_demands" ? { data: { id: "nd1", tenant_id: "t2", status: "paused" } } : undefined;
    const { respondToNetworkDemand } = await import("./demands");
    const res = await respondToNetworkDemand({}, fd({ network_demand_id: "nd1", property_hint: "Kadıköy · 3+1" }));
    expect(res).toEqual({ error: "Talep artık ağda aktif değil." });
    expect(mock.forTable("network_demand_responses", "insert")).toHaveLength(0);
  });

  it("kendi talebine yanıt verilemez", async () => {
    resolver = (q) =>
      q.table === "network_demands" ? { data: { id: "nd1", tenant_id: "t1", status: "active" } } : undefined;
    const { respondToNetworkDemand } = await import("./demands");
    const res = await respondToNetworkDemand({}, fd({ network_demand_id: "nd1", property_hint: "Kadıköy · 3+1" }));
    expect(res).toEqual({ error: "Kendi talebinize yanıt gönderemezsiniz." });
    expect(mock.forTable("network_demand_responses", "insert")).toHaveLength(0);
  });

  it("başka ofise gelen yanıt kabul edilemez (to_tenant_id süzgeci)", async () => {
    resolver = () => ({ data: null });
    const { acceptDemandResponse } = await import("./demands");
    const res = await acceptDemandResponse("foreign-resp");
    expect(res).toEqual({ error: "Yanıt bulunamadı." });
    const [lookup] = mock.forTable("network_demand_responses", "select");
    expect(hasFilter(lookup, "eq", "to_tenant_id", "t1")).toBe(true);
    expect(mock.forTable("network_demand_responses", "update")).toHaveLength(0);
  });

  it("yanıtı yalnız gönderen ofis geri çekebilir", async () => {
    resolver = () => ({ data: [] });
    const { withdrawDemandResponse } = await import("./demands");
    const res = await withdrawDemandResponse("someone-elses");
    expect(res).toEqual({ error: "Yalnız bekleyen yanıtlar geri çekilebilir." });
    const [upd] = mock.forTable("network_demand_responses", "update");
    expect(hasFilter(upd, "eq", "from_tenant_id", "t1")).toBe(true);
    expect(hasFilter(upd, "eq", "status", "pending")).toBe(true);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("ağ talebi duraklatma/kaldırma kendi tenant'ına kilitli", async () => {
    const { pauseDemand, removeDemandFromNetwork } = await import("./demands");
    expect(await pauseDemand("nd1")).toEqual({ ok: true });
    expect(await removeDemandFromNetwork("nd1")).toEqual({ ok: true });
    for (const q of mock.forTable("network_demands")) expect(hasFilter(q, "eq", "tenant_id", "t1")).toBe(true);
  });
});

describe("havuz okumaları (queries)", () => {
  it("portföy havuzu yalnız aktif ve silinmemiş ilanları okur; DTO maskelidir", async () => {
    resolver = (q) => {
      if (q.table === "network_listings") {
        return {
          data: [
            {
              id: "l1",
              tenant_id: "t2",
              commission_share_pct: 25,
              note: null,
              created_at: "2026-10-01T00:00:00Z",
              property: {
                title: "Deniz manzaralı",
                transaction_type: "sale",
                property_type: "apartment",
                features: { rooms: "3+1", sqm: 120, owner_phone: "0555" },
                list_price: 5_000_000,
                province: { name: "İstanbul" },
                district: { name: "Kadıköy" },
              },
              office: { name: "Diğer Ofis", province: { name: "İstanbul" } },
            },
          ],
        };
      }
      return undefined;
    };
    const { listNetworkPool } = await import("./queries");
    const rows = await listNetworkPool();
    const [pool] = mock.forTable("network_listings");
    expect(hasFilter(pool, "eq", "status", "active")).toBe(true);
    expect(hasFilter(pool, "is", "property.deleted_at", null)).toBe(true);
    const [mine] = mock.forTable("network_requests");
    expect(hasFilter(mine, "eq", "from_tenant_id", "t1")).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ listingId: "l1", isOwn: false, rooms: "3+1", sqm: 120, districtName: "Kadıköy" });
    expect(JSON.stringify(rows[0])).not.toContain("0555");
  });

  it("talep havuzu yalnız aktif ve açık durumdaki talepleri okur; bütçe yuvarlanır", async () => {
    resolver = (q) => {
      if (q.table === "network_demands") {
        return {
          data: [
            {
              id: "nd1",
              tenant_id: "t2",
              commission_share_pct: 20,
              note: null,
              created_at: "2026-10-01T00:00:00Z",
              demand: {
                id: "d1",
                transaction_type: "sale",
                property_type: "apartment",
                rooms: "2+1",
                budget_min: 3_450_000,
                budget_max: 4_120_000,
                status: "active",
                province: { name: "İzmir" },
                district: { name: "Bornova" },
              },
              office: { name: "Diğer Ofis", province: null },
            },
          ],
        };
      }
      return undefined;
    };
    const { listNetworkDemandPool } = await import("./queries");
    const rows = await listNetworkDemandPool();
    const [pool] = mock.forTable("network_demands");
    expect(hasFilter(pool, "eq", "status", "active")).toBe(true);
    const statusIn = pool.filters.find((f) => f.method === "in" && f.args[0] === "demand.status");
    expect(statusIn?.args[1]).toEqual(expect.arrayContaining(["new", "active", "matched"]));
    expect(statusIn?.args[1]).not.toContain("closed");
    expect(rows[0]).toMatchObject({ networkDemandId: "nd1", isOwn: false, budgetMin: 3_400_000, budgetMax: 4_200_000 });
  });

  it("kendi listelerim yalnız kendi tenant'ımla süzülür", async () => {
    resolver = () => ({ data: [] });
    const q = await import("./queries");
    await q.listMyNetworkListings();
    await q.listMyRequests();
    await q.listMyNetworkDemands();
    await q.listMyDemandResponses();
    expect(hasFilter(mock.forTable("network_listings")[0], "eq", "tenant_id", "t1")).toBe(true);
    expect(hasFilter(mock.forTable("network_requests")[0], "eq", "from_tenant_id", "t1")).toBe(true);
    expect(hasFilter(mock.forTable("network_demands")[0], "eq", "tenant_id", "t1")).toBe(true);
    expect(hasFilter(mock.forTable("network_demand_responses")[0], "eq", "from_tenant_id", "t1")).toBe(true);
  });
});
