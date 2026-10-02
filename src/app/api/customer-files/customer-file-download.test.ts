import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const FILE_ID = "123e4567-e89b-42d3-a456-426614174000";
const TENANT_ID = "123e4567-e89b-42d3-a456-426614174001";
const CUSTOMER_ID = "123e4567-e89b-42d3-a456-426614174002";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  filters: [] as { column: string; value: unknown }[],
  row: null as null | {
    customer_id: string;
    file_name: string;
    file_type: string;
    storage_path: string;
  },
  lookupError: null as null | { code: string },
  download: vi.fn(),
}));

vi.mock("@/lib/require-permission", () => ({ requirePermission: mocks.gate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from "@/app/api/customer-files/[id]/download/route";

function context(id = FILE_ID) {
  return { params: Promise.resolve({ id }) };
}

function request(query = "") {
  return new NextRequest(`https://example.test/api/customer-files/${FILE_ID}/download${query}`);
}

describe("private customer-file download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filters.length = 0;
    mocks.row = null;
    mocks.lookupError = null;
    mocks.gate.mockResolvedValue({
      ok: true,
      userId: "user-1",
      tenantId: TENANT_ID,
      role: "advisor",
    });
    mocks.download.mockResolvedValue({
      data: new Blob(["%PDF-1.7\n1 0 obj\nendobj\n%%EOF"], { type: "application/pdf" }),
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      from: () => {
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            mocks.filters.push({ column, value });
            return builder;
          },
          maybeSingle: async () => ({ data: mocks.row, error: mocks.lookupError }),
        };
        return builder;
      },
    });
    mocks.createAdminClient.mockReturnValue({
      storage: { from: () => ({ download: mocks.download }) },
    });
  });

  it("denies before metadata/storage access when permission fails", async () => {
    mocks.gate.mockResolvedValue({ ok: false, error: "Yetkisiz" });
    const response = await GET(request(), context());
    expect(response.status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("tenant-scopes metadata and rejects storage paths outside that customer", async () => {
    mocks.row = {
      customer_id: CUSTOMER_ID,
      file_name: "rapor.pdf",
      file_type: "application/pdf",
      storage_path: `${TENANT_ID}/another-customer/rapor.pdf`,
    };
    const response = await GET(request(), context());
    expect(response.status).toBe(404);
    expect(mocks.filters).toContainEqual({ column: "tenant_id", value: TENANT_ID });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("revalidates a legacy PDF before serving it inline", async () => {
    mocks.row = {
      customer_id: CUSTOMER_ID,
      file_name: "rapor.pdf",
      file_type: "application/pdf",
      storage_path: `${TENANT_ID}/${CUSTOMER_ID}/rapor.pdf`,
    };
    const response = await GET(request("?onizle=1"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("inline;");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cdn-cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("downgrades forged inline content to an inert attachment and .bin name", async () => {
    mocks.row = {
      customer_id: CUSTOMER_ID,
      file_name: "payload.html",
      file_type: "application/pdf",
      storage_path: `${TENANT_ID}/${CUSTOMER_ID}/payload.pdf`,
    };
    mocks.download.mockResolvedValue({
      data: new Blob(["<html><script>alert(1)</script></html>"], { type: "text/html" }),
      error: null,
    });
    const response = await GET(request("?onizle=1"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-disposition")).toContain("payload.bin");
  });

  it("normalizes legacy names before constructing Content-Disposition", async () => {
    mocks.row = {
      customer_id: CUSTOMER_ID,
      file_name: "rapor\"\r\nX-Evil: yes/son.html",
      file_type: "application/pdf",
      storage_path: `${TENANT_ID}/${CUSTOMER_ID}/rapor.pdf`,
    };
    const response = await GET(request(), context());
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(response.status).toBe(200);
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).not.toContain("X-Evil:");
    expect(disposition).toContain(".pdf");
  });
});
