import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Proxy (middleware) paketi her istekte soğuk başlayabilir; `next/server` barrel'ı `after`/`connection`/`ImageResponse`
 * üzerinden tüm app-page çalışma zamanını (~700 KB, soğukta 140+ ms) pakete çeker. Proxy yolunda `next/server`
 * yalnız TİP olarak alınır; `NextResponse` sınıfı barrel'ın yeniden dışa aktardığı dosyadan doğrudan gelir.
 */
const ROOT = process.cwd();
const PROXY_FILES = ["src/proxy.ts", "src/lib/supabase/middleware.ts"];

describe("proxy paketi next/server barrel'ını çalışma zamanında yüklemez", () => {
  for (const f of PROXY_FILES) {
    it(`${f}: next/server yalnız import type`, () => {
      const text = readFileSync(join(ROOT, f), "utf8");
      const lines = text.split(/\r?\n/).filter((l) => /from\s+"next\/server"/.test(l));
      for (const l of lines) expect(l, `${f}: ${l}`).toMatch(/^import type\s/);
    });
  }

  it("NextResponse, next/server barrel'ının yeniden dışa aktardığı dosyadan alınır", () => {
    const text = readFileSync(join(ROOT, "src/lib/supabase/middleware.ts"), "utf8");
    expect(text).toMatch(/import \{ NextResponse \} from "next\/dist\/server\/web\/spec-extension\/response"/);
    const barrel = readFileSync(join(ROOT, "node_modules/next/server.js"), "utf8");
    expect(barrel).toContain("require('next/dist/server/web/spec-extension/response')");
  });
});
