import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PID = "123e4567-e89b-42d3-a456-426614174000";
const TENANT = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  rate: vi.fn(),
  download: vi.fn(),
  logActivity: vi.fn(),
  property: null as null | Record<string, unknown>,
  media: [] as Record<string, unknown>[],
  mediaError: null as null | { code: string },
  selects: [] as string[],
  filters: [] as { table: string; column: string; value: unknown }[],
}));

vi.mock("@/lib/require-permission", () => ({ requirePermission: mocks.gate }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const builder = {
        select: (c: string) => {
          mocks.selects.push(`${table}:${c}`);
          return builder;
        },
        eq: (column: string, value: unknown) => {
          mocks.filters.push({ table, column, value });
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: table === "properties" ? mocks.property : null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          if (mocks.mediaError) return resolve({ data: null, error: mocks.mediaError });
          return resolve({ data: mocks.media, error: null });
        },
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ download: mocks.download }) } }),
}));

import { GET } from "@/app/api/property-media/zip/[propertyId]/route";

function call(query = "") {
  return GET(new Request(`https://example.test/api/property-media/zip/${PID}${query}`), {
    params: Promise.resolve({ propertyId: PID }),
  });
}

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "image",
    storage_path: `${TENANT}/${PID}/${id}.jpg`,
    file_name: `${id}.jpg`,
    file_type: "image/jpeg",
    file_size: 1000,
    is_cover: false,
    has_watermark: true,
    is_document: false,
    room_tag: null,
    caption: null,
    ...extra,
  };
}

describe("toplu medya ZIP ucu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selects.length = 0;
    mocks.filters.length = 0;
    mocks.mediaError = null;
    mocks.gate.mockResolvedValue({ ok: true, userId: "u1", tenantId: TENANT, role: "advisor" });
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.property = { id: PID, property_code: "PF-7", title: "Moda 3+1" };
    mocks.download.mockImplementation(async (path: string) => ({
      data: new Blob([`bytes:${path.split("/").pop()}`], { type: "image/jpeg" }),
      error: null,
    }));
    mocks.media = [];
  });

  it("yetki yoksa depoya dokunmadan 403", async () => {
    mocks.gate.mockResolvedValue({ ok: false, error: "Yetkiniz yok." });
    const res = await call();
    expect(res.status).toBe(403);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("hız sınırı aşılınca 429", async () => {
    mocks.rate.mockResolvedValue({ allowed: false });
    expect((await call()).status).toBe(429);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("başka ofisin portföyü 404 (kiracı filtresi)", async () => {
    mocks.property = null;
    expect((await call()).status).toBe(404);
    expect(mocks.filters).toContainEqual({ table: "properties", column: "tenant_id", value: TENANT });
    expect(mocks.filters).toContainEqual({ table: "property_media", column: "tenant_id", value: TENANT });
  });

  it("galeri sırasıyla ZIP: kapak önce, kat planı sonda; belge ve güvensiz yol girmez", async () => {
    mocks.media = [
      row("kapak", { is_cover: true, room_tag: "salon" }),
      row("plan", { room_tag: "kat_plani", file_type: "image/png" }),
      row("tapu", { is_document: true }),
      row("yabanci", { storage_path: `other-tenant/${PID}/x.jpg` }),
      row("mutfak", { caption: "Ankastre mutfak" }),
    ];
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("PF-7-fotograflar.zip");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["01-salon.jpg", "02-ankastre-mutfak.jpg", "03-kat-plani.png"]);
    expect(new TextDecoder().decode(files["01-salon.jpg"])).toBe("bytes:kapak.jpg");
    expect(mocks.download).toHaveBeenCalledTimes(3);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "property_media.zip_download", newValue: expect.objectContaining({ count: 3 }) }),
    );
  });

  it("okunamayan görsel atlanır ve OKUBENI.txt ile bildirilir", async () => {
    mocks.media = [row("a"), row("b")];
    mocks.download.mockImplementation(async (path: string) =>
      path.endsWith("b.jpg") ? { data: null, error: { message: "yok" } } : { data: new Blob(["ok"]), error: null },
    );
    const files = unzipSync(new Uint8Array(await (await call()).arrayBuffer()));
    expect(Object.keys(files)).toEqual(["01.jpg", "OKUBENI.txt"]);
    expect(new TextDecoder().decode(files["OKUBENI.txt"])).toContain("02.jpg");
  });

  it("fotoğraf yoksa 404", async () => {
    mocks.media = [row("tapu", { is_document: true })];
    expect((await call()).status).toBe(404);
  });
});
