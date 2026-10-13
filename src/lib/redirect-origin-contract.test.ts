import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Mutlak URL / yönlendirme kökü sözleşmesi: src/app altındaki route.ts ve page.tsx dosyaları
 * mutlak adresi istekten (req.url, request.url, nextUrl.origin) KURMAZ — ters vekil arkasında
 * bu değerler konteynerin iç adresidir (http://0.0.0.0:3000). Kök tek kaynaktan gelir:
 * `publicUrl` / `publicRedirect` / `publicOrigin` (`src/lib/public-redirect.ts` → getBaseUrl).
 * Tek argümanlı `new URL(req.url)` (yalnız searchParams/pathname okumak) serbesttir.
 */

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name === "route.ts" || entry.name === "page.tsx" ? [path] : [];
  });
}

/** Gerekçeli istisnalar: dosya yolu → neden. Yeni satır eklemeden önce publicRedirect'i düşün. */
const EXCEPTIONS: Record<string, string> = {};

const FORBIDDEN: Array<{ name: string; re: RegExp }> = [
  { name: "nextUrl.origin", re: /nextUrl\.origin/ },
  { name: "new URL(..., req.url|request.url)", re: /new URL\([^;]*?,\s*(?:_?req|request)\.url\s*\)/ },
];

describe("redirect origin contract", () => {
  it("src/app route/page files never derive absolute URLs from the incoming request", () => {
    const offenders = sourceFiles("src/app")
      .map((file) => relative(".", file).replaceAll("\\", "/"))
      .filter((file) => !(file in EXCEPTIONS))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return FORBIDDEN.filter((rule) => rule.re.test(text)).map((rule) => `${file}: ${rule.name}`);
      });
    expect(offenders).toEqual([]);
  });

  it("the exception list only names files that still exist", () => {
    for (const file of Object.keys(EXCEPTIONS)) {
      expect(() => readFileSync(file, "utf8")).not.toThrow();
    }
  });
});

describe("public redirect Location headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("@/lib/growth/store");
    vi.doUnmock("@/lib/supabase/server");
  });

  it("/r/<kod> lands on NEXT_PUBLIC_APP_URL even when the request arrives on 0.0.0.0", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://emlaksoft.com.tr");
    vi.doMock("@/lib/growth/store", () => ({
      countClickSafe: vi.fn(async () => undefined),
      recordSignupAttributionSafe: vi.fn(async () => undefined),
    }));
    const { GET } = await import("@/app/r/[code]/route");
    const res = await GET(new NextRequest("http://0.0.0.0:3000/r/abc"), { params: Promise.resolve({ code: "abc" }) });
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://emlaksoft.com.tr/")).toBe(true);
    expect(location).not.toContain("0.0.0.0");
  });

  it("/auth/eposta-dogrula lands on NEXT_PUBLIC_APP_URL and keeps the query", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://emlaksoft.com.tr");
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ auth: { exchangeCodeForSession: async () => ({ error: null }), updateUser: async () => ({ error: null }) } }),
    }));
    const { GET } = await import("@/app/auth/eposta-dogrula/route");
    const ok = await GET(new NextRequest("http://0.0.0.0:3000/auth/eposta-dogrula?code=x"));
    expect(ok.headers.get("location")).toBe("https://emlaksoft.com.tr/app?eposta=dogrulandi");
    const missing = await GET(new NextRequest("http://0.0.0.0:3000/auth/eposta-dogrula"));
    expect(missing.headers.get("location")).toBe("https://emlaksoft.com.tr/app?eposta=hata");
  });
});
