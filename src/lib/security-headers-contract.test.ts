import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const config = readFileSync("next.config.ts", "utf8");

describe("security header contract", () => {
  it("ships a global CSP with restrictive structural directives", () => {
    expect(config).toContain('{ key: "Content-Security-Policy", value: contentSecurityPolicy }');
    expect(config).toContain('"object-src \'none\'"');
    expect(config).toContain('"base-uri \'self\'"');
    expect(config).toContain('"form-action \'self\'"');
    expect(config).toContain('"frame-ancestors \'self\'"');
  });

  it("does not allow eval in production and keeps the service worker no-store", () => {
    expect(config).toContain('isDevelopment ? " \'unsafe-eval\'" : ""');
    expect(config).toContain('source: "/sw.js"');
    expect(config).toContain("no-store, no-cache, must-revalidate, proxy-revalidate");
    expect(config).toContain("default-src 'self'; script-src 'self'; object-src 'none'");
  });
});

/** next.config.ts'teki CSP dizi gövdesi (yorumlar hariç; değişken eklemeleri metin olarak kalır). */
function cspSource(): string {
  const start = config.indexOf("const contentSecurityPolicy = [");
  const end = config.indexOf('].join("; ");', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return config.slice(start, end);
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return e.name === "route.ts" ? [p] : [];
  });
}

describe("KQ1: CSP, yönlendirme kökü ve sır sınırı", () => {
  it("CSP joker bulut Supabase desenlerini içermez (connect/img/media)", () => {
    const csp = cspSource();
    expect(csp).not.toContain("supabase.co");
    expect(config).not.toMatch(/hostname:\s*"\*\.supabase\.co"/);
  });

  it("src/app route.ts dosyaları yönlendirme adresini req.nextUrl.clone()'dan kurmaz (0.0.0.0:3000 sızıntısı)", () => {
    const offenders = routeFiles("src/app").filter((f) => {
      const text = readFileSync(f, "utf8");
      return /NextResponse\.redirect\(\s*(?:_?req|request)\.nextUrl\.clone\(\)/.test(text) || /\.nextUrl\.clone\(\)/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("service_role istemcisi ve sır okuyan yardımcılar istemci paketine giremez (server-only)", () => {
    for (const f of [
      "src/lib/supabase/admin.ts",
      "src/lib/settings/secrets.ts",
      "src/lib/platform-secrets.ts",
      "src/lib/two-factor.ts",
      "src/lib/cron-auth.ts",
      "src/lib/static-home/internal-token.ts",
    ]) {
      expect(readFileSync(f, "utf8").startsWith('import "server-only";'), f).toBe(true);
    }
  });

  it("statik sayfa yanıtı herkese açık iç sunum başlığı (x-static-home) taşımaz; X-Static yalnız jetonlu öz teste", () => {
    const render = readFileSync("src/lib/static-home/render.ts", "utf8");
    expect(render).not.toMatch(/set\(\s*"X-Static-Home"/i);
    expect(render).toContain("hasValidStaticProbe(request.headers)");
  });
});

describe("KQ1: /app/ara Location kökü", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@/lib/require-permission");
    vi.doUnmock("@/lib/supabase/server");
  });

  it("istek 0.0.0.0:3000'den gelse de Location herkese açık köktür (tek eşleşme → müşteri kartı)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://emlaksoft.com.tr");
    vi.doMock("@/lib/require-permission", () => ({
      requirePermission: async () => ({ ok: true, tenantId: "t1", userId: "u1", role: "owner" }),
    }));
    const query: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "ilike", "limit"]) query[m] = () => query;
    query.then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: "c1" }], error: null });
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => query }) }));
    const { GET } = await import("@/app/app/ara/route");
    const res = await GET(new NextRequest("http://0.0.0.0:3000/app/ara?tel=05321000001"));
    const location = res.headers.get("location") ?? "";
    expect(res.status).toBe(303);
    expect(location).toBe("https://emlaksoft.com.tr/app/musteriler/c1");
    expect(location).not.toMatch(/0\.0\.0\.0|localhost|:3000/);
  });
});
