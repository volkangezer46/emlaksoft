import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { EXPORT_ENTITIES } from "@/lib/export-entities";
import { openFullCsvStream } from "@/lib/export-full";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  checkRateLimit: vi.fn(),
  logActivity: vi.fn(),
  createClient: vi.fn(),
  getEffectivePermissions: vi.fn(),
}));

vi.mock("@/lib/require-permission", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/permissions-effective", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions-effective")>()),
  getEffectivePermissions: mocks.getEffectivePermissions,
}));

const GATE_OK = { ok: true, userId: "u1", tenantId: "t1", role: "owner", impersonating: false };

/** Zincirleme builder: tablo -> satır dizisi; range sayfa döner, profiles zinciri thenable. */
function fakeSupabase(tables: Record<string, Record<string, unknown>[]>, opts: { failFirstPage?: boolean } = {}) {
  const ranges: [string, number, number][] = [];
  const calls: [string, string, unknown[]][] = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "neq", "order", "in"]) {
        chain[m] = (...args: unknown[]) => {
          calls.push([table, m, args]);
          return chain;
        };
      }
      chain.range = (from: number, to: number) => {
        ranges.push([table, from, to]);
        if (opts.failFirstPage) return Promise.resolve({ data: null, error: { message: "boom" } });
        return Promise.resolve({ data: (tables[table] ?? []).slice(from, to + 1), error: null });
      };
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null });
      return chain;
    },
  };
  return { client, ranges, calls };
}

const req = new Request("https://emlaksoft.example/api/export/musteriler");
const ctx = (entity: string) => ({ params: Promise.resolve({ entity }) });

function customers(n: number, name = (i: number) => `Müşteri ${i}`) {
  return Array.from({ length: n }, (_, i) => ({
    full_name: name(i),
    phone: "0555",
    email: null,
    customer_types: ["alici"],
    tags: [],
    source: "web",
    created_at: "2026-01-01",
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requirePermission.mockResolvedValue(GATE_OK);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.logActivity.mockResolvedValue({ ok: true });
  mocks.getEffectivePermissions.mockResolvedValue({ earnings_all: ["view"] });
});

describe("GET /api/export/[entity]", () => {
  it("bilinmeyen ve desteklenmeyen varlık 404 (kapıya bile gitmez)", async () => {
    expect((await GET(req, ctx("yok"))).status).toBe(404);
    expect((await GET(req, ctx("kiralama"))).status).toBe(404);
    expect((await GET(req, ctx("constructor"))).status).toBe(404);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it("oturum yoksa 401, yetki yoksa 403 ve veri okunmaz", async () => {
    mocks.requirePermission.mockResolvedValueOnce({ ok: false, error: "Oturum bulunamadı." });
    expect((await GET(req, ctx("musteriler"))).status).toBe(401);
    mocks.requirePermission.mockResolvedValueOnce({ ok: false, error: "Bu işlem için yetkiniz yok." });
    expect((await GET(req, ctx("musteriler"))).status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("her varlık kendi modülünün view kapısından geçer", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}).client);
    for (const def of Object.values(EXPORT_ENTITIES)) {
      mocks.requirePermission.mockClear();
      await (await GET(req, ctx(def.slug))).text();
      expect(mocks.requirePermission).toHaveBeenCalledWith(def.module, "view");
    }
  });

  it("hız sınırı aşılırsa 429", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false });
    const res = await GET(req, ctx("musteriler"));
    expect(res.status).toBe(429);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("sayfalama döngüsü tüm satırları verir; BOM, başlık, Content-Disposition ve audit", async () => {
    const fake = fakeSupabase({ customers: customers(2500) });
    mocks.createClient.mockResolvedValue(fake.client);
    const res = await GET(req, ctx("musteriler"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="musteriler-tam-\d{4}-\d{2}-\d{2}\.csv"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM (Excel Türkçe)
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    const lines = text.slice(1).trimEnd().split("\n");
    expect(lines[0]).toBe("ad,telefon,email,tur,etiketler,kaynak,kayit");
    expect(lines).toHaveLength(1 + 2500);
    expect(lines.some((l) => l.startsWith("UYARI"))).toBe(false);
    expect(fake.ranges).toEqual([
      ["customers", 0, 999],
      ["customers", 1000, 1999],
      ["customers", 2000, 2999],
    ]);
    // tenant sınırı + aktör kapsamı yok (owner), sayfa kararlılığı için id sırası
    expect(fake.calls).toContainEqual(["customers", "eq", ["tenant_id", "t1"]]);
    expect(fake.calls).toContainEqual(["customers", "order", ["id", { ascending: true }]]);
    await vi.waitFor(() => expect(mocks.logActivity).toHaveBeenCalledTimes(1));
    expect(mocks.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        actorId: "u1",
        action: "export.csv.full",
        entityType: "musteriler",
        newValue: expect.objectContaining({ rows: 2500, truncated: false, stopReason: null }),
      }),
    );
  });

  it("danışman rolü yalnız kendi kayıtlarını filtreler (aktör kapsamı korunur)", async () => {
    mocks.requirePermission.mockResolvedValue({ ...GATE_OK, role: "agent" });
    const fake = fakeSupabase({ customers: customers(3) });
    mocks.createClient.mockResolvedValue(fake.client);
    await (await GET(req, ctx("musteriler"))).text();
    expect(fake.calls).toContainEqual(["customers", "eq", ["assigned_to", "u1"]]);
  });

  it("B1: şube müdürü earnings_all olmadan komisyon akışında yalnız kendi anlaşmalarını alır", async () => {
    mocks.requirePermission.mockResolvedValue({ ...GATE_OK, role: "branch_manager" });
    mocks.getEffectivePermissions.mockResolvedValue({ commissions: ["view"] });
    const fake = fakeSupabase({ commissions: [] });
    mocks.createClient.mockResolvedValue(fake.client);
    await (await GET(req, ctx("komisyonlar"))).text();
    expect(fake.calls).toContainEqual(["commissions", "eq", ["deal.assigned_to", "u1"]]);
  });

  it("B1: earnings_all sahibi ofis geneli komisyon akışını alır", async () => {
    const fake = fakeSupabase({ commissions: [] });
    mocks.createClient.mockResolvedValue(fake.client);
    await (await GET(req, ctx("komisyonlar"))).text();
    expect(fake.calls).not.toContainEqual(["commissions", "eq", ["deal.assigned_to", "u1"]]);
  });

  it("boş sonuç: yalnız BOM, 200", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({ customers: [] }).client);
    const res = await GET(req, ctx("musteriler"));
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("CSV formül enjeksiyonu kaçırılır", async () => {
    const rows = customers(3, (i) => ["=HYPERLINK(\"http://x\")", "@SUM(A1)", '+cmd|"/c calc"'][i]!);
    mocks.createClient.mockResolvedValue(fakeSupabase({ customers: rows }).client);
    const text = await (await GET(req, ctx("musteriler"))).text();
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).toContain(`"'@SUM(A1)"`);
    expect(text).toContain(`"'+cmd|""/c calc"""`);
    expect(text).not.toMatch(/(^|,)"=HYPERLINK/m);
  });

  it("ilk sayfa hatası 500 döner, audit yazılmaz", async () => {
    mocks.createClient.mockResolvedValue(fakeSupabase({}, { failFirstPage: true }).client);
    const res = await GET(req, ctx("musteriler"));
    expect(res.status).toBe(500);
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("isim çözümü: denetimde aktör adı profiles'tan (tenant kapsamlı) gelir", async () => {
    const fake = fakeSupabase({
      audit_logs: [{ action: "x", entity_type: "e", entity_id: null, actor_id: "a1", old_value: null, new_value: null, created_at: "d" }],
      profiles: [{ id: "a1", full_name: "Ayşe" }],
    });
    mocks.createClient.mockResolvedValue(fake.client);
    const text = await (await GET(req, ctx("denetim"))).text();
    expect(text).toContain('"Ayşe"');
    expect(fake.calls).toContainEqual(["profiles", "eq", ["tenant_id", "t1"]]);
  });
});

describe("openFullCsvStream güvenlik sınırları", () => {
  const def = EXPORT_ENTITIES.musteriler!;
  const gate = { tenantId: "t1", userId: "u1", role: "owner" };

  it("satır sınırına ulaşılırsa son satırda açık uyarı ve truncated audit özeti", async () => {
    const fake = fakeSupabase({ customers: customers(3000) });
    const onDone = vi.fn();
    const opened = await openFullCsvStream({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fake.client as any,
      gate,
      def,
      buildQuery: (sb) => sb.from("customers").select("*").eq("tenant_id", "t1") as never,
      maxRows: 1500,
      onDone,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const text = await new Response(opened.stream).text(); // TextDecoder BOM'u atar
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(1 + 1500 + 1);
    expect(lines.at(-1)).toContain("UYARI: Güvenlik sınırı");
    expect(lines.at(-1)).toContain("1500");
    expect(onDone).toHaveBeenCalledWith({ rows: 1500, truncated: true, stopReason: "rows" });
  });

  it("istemci iptalinde de audit özeti bir kez yazılır", async () => {
    const fake = fakeSupabase({ customers: customers(5000) });
    const onDone = vi.fn();
    const opened = await openFullCsvStream({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fake.client as any,
      gate,
      def,
      buildQuery: (sb) => sb.from("customers").select("*") as never,
      onDone,
    });
    if (!opened.ok) throw new Error("açılmalı");
    const reader = opened.stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]![0].stopReason).toBe("aborted");
  });
});

describe("hızlı dışa aktarma ile sapma koruması", () => {
  const exportSource = readFileSync("src/app/actions/export.ts", "utf8");
  const fullSource = readFileSync("src/lib/export-full.ts", "utf8");

  it("her tam-akış varlığı export.ts'teki aynı yetki kapısını kullanır", () => {
    for (const def of Object.values(EXPORT_ENTITIES)) {
      expect(exportSource, def.slug).toContain(`requirePermission("${def.module}", "view")`);
      expect(exportSource, def.slug).toContain(`exportResult(gate, "${def.slug}"`);
    }
  });

  it("export-full sorgularındaki select ifadeleri export.ts ile birebir aynıdır", () => {
    const selects = [...fullSource.matchAll(/\.select\(\s*"([^"]+)"\s*,?\s*\)/g)].map((m) => m[1]!);
    // profiles ("id, full_name") dışındaki 14 varlık sorgusu
    const entitySelects = selects.filter((s) => s !== "id, full_name");
    expect(entitySelects).toHaveLength(14);
    for (const s of entitySelects) expect(exportSource).toContain(`"${s}"`);
  });

  it("her tam-akış sorgusu tenant sınırını ve id sıra anahtarını taşır", () => {
    const chains = [...fullSource.matchAll(/\.from\("([^"]+)"\)([\s\S]*?);\n/g)].filter((m) => m[1] !== "profiles");
    expect(chains).toHaveLength(14);
    for (const c of chains) expect(c[0], c[1]).toContain('.eq("tenant_id", gate.tenantId)');
    expect(fullSource.match(/\.order\("id", ID_ORDER\)/g)!.length).toBe(14);
  });

  it("route admin client kullanmaz", () => {
    const route = readFileSync("src/app/api/export/[entity]/route.ts", "utf8");
    expect(route).not.toContain("createAdminClient");
    expect(fullSource).not.toContain("createAdminClient");
  });
});
