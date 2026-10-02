import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, VITRIN_FAVORITES_MAX_BYTES } from "./route";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

const PROPERTY_ID = "11111111-1111-4111-8111-111111111111";

function request(body: string, contentLength?: number) {
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return new NextRequest("https://emlaksoft.example/api/vitrin-favoriler", {
    method: "POST",
    headers,
    body,
  });
}

type QueryResult = { data: unknown; error: unknown };

function adminClient(results: {
  tenant: QueryResult;
  properties?: QueryResult;
  media?: QueryResult;
}) {
  const tenantQuery = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue(results.tenant),
      }),
    }),
  };
  const propertyQuery = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue(results.properties),
          }),
        }),
      }),
    }),
  };
  const mediaQuery = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue(results.media),
          }),
        }),
      }),
    }),
  };
  return {
    from: vi.fn((table: string) => {
      if (table === "tenants") return tenantQuery;
      if (table === "properties") return propertyQuery;
      return mediaQuery;
    }),
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  consoleError.mockRestore();
});

describe("vitrin favorites public request boundary", () => {
  it("rejects an oversized declared Content-Length before reading the body", async () => {
    const response = await POST(request("{}", VITRIN_FAVORITES_MAX_BYTES + 1));
    expect(response.status).toBe(413);
  });

  it("rejects an oversized raw body when Content-Length is absent", async () => {
    const response = await POST(request("x".repeat(VITRIN_FAVORITES_MAX_BYTES + 1)));
    expect(response.status).toBe(413);
  });

  it("rejects malformed bounded JSON without reaching the database", async () => {
    const response = await POST(request("{"));
    expect(response.status).toBe(400);
  });

  it("preserves the empty-favorites response without a database lookup", async () => {
    const response = await POST(request(JSON.stringify({ slug: "ornek-ofis", ids: [] })));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [] });
  });

  it.each(["null", "42", '"scalar"', "[]", '[{"slug":"ornek-ofis"}]'])(
    "rejects a non-object JSON body: %s",
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(mocks.checkRateLimit).not.toHaveBeenCalled();
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      operation: "tenant_lookup",
      results: {
        tenant: { data: null, error: { code: "PGRST500", message: "sensitive tenant error" } },
      },
    },
    {
      operation: "property_lookup",
      results: {
        tenant: { data: { id: "tenant-secret", status: "active" }, error: null },
        properties: {
          data: null,
          error: { code: "PGRST501", message: "sensitive property error" },
        },
      },
    },
    {
      operation: "media_lookup",
      results: {
        tenant: { data: { id: "tenant-secret", status: "active" }, error: null },
        properties: {
          data: [
            {
              id: PROPERTY_ID,
              title: "İlan",
              property_code: "P-1",
              transaction_type: "sale",
              list_price: 1,
              features: {},
              province: null,
              district: null,
            },
          ],
          error: null,
        },
        media: { data: null, error: { code: "PGRST502", message: "sensitive media error" } },
      },
    },
  ])("fails closed on $operation without logging sensitive query context", async ({ operation, results }) => {
    mocks.createAdminClient.mockReturnValue(adminClient(results));

    const response = await POST(
      request(JSON.stringify({ slug: "private-office-slug", ids: [PROPERTY_ID] })),
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: "Hizmet geçici olarak kullanılamıyor. Lütfen daha sonra tekrar deneyin.",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "vitrin favorites database unavailable",
      expect.objectContaining({ operation }),
    );
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("sensitive");
    expect(logged).not.toContain("private-office-slug");
    expect(logged).not.toContain("tenant-secret");
    expect(logged).not.toContain(PROPERTY_ID);
  });
});
