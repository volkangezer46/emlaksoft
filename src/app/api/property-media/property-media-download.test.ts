import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  tenantFilters: [] as { column: string; value: unknown }[],
  media: null as null | { property_id: string; storage_path: string; file_name: string; file_type: string },
  download: vi.fn(),
}));

vi.mock("@/lib/require-permission", () => ({ requirePermission: mocks.gate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from "@/app/api/property-media/[id]/download/route";

function params(id = "123e4567-e89b-42d3-a456-426614174000") {
  return { params: Promise.resolve({ id }) };
}

describe("authorized property media download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantFilters.length = 0;
    mocks.media = null;
    mocks.gate.mockResolvedValue({
      ok: true,
      userId: "user-1",
      tenantId: "tenant-a",
      role: "advisor",
    });

    mocks.createClient.mockResolvedValue({
      from: () => {
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            mocks.tenantFilters.push({ column, value });
            return builder;
          },
          maybeSingle: async () => ({ data: mocks.media }),
        };
        return builder;
      },
    });
    mocks.download.mockResolvedValue({
      data: new Blob(["image"], { type: "image/jpeg" }),
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({
      storage: { from: () => ({ download: mocks.download }) },
    });
  });

  it("denies requests before storage access when authentication/permission fails", async () => {
    mocks.gate.mockResolvedValue({ ok: false, error: "Oturum bulunamadı." });

    const response = await GET(new Request("https://example.test/api/property-media/x/download"), params());

    expect(response.status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("binds the media lookup to the canonical tenant and denies cross-tenant ids", async () => {
    const response = await GET(new Request("https://example.test/api/property-media/x/download"), params());

    expect(response.status).toBe(404);
    expect(mocks.tenantFilters).toContainEqual({ column: "tenant_id", value: "tenant-a" });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("serves authorized media without browser/CDN caching or MIME sniffing", async () => {
    mocks.media = {
      property_id: "property-1",
      storage_path: "tenant-a/property-1/property.jpg",
      file_name: "property.jpg",
      file_type: "image/jpeg",
    };

    const response = await GET(new Request("https://example.test/api/property-media/x/download"), params());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cdn-cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.download).toHaveBeenCalledWith("tenant-a/property-1/property.jpg");
  });
});
