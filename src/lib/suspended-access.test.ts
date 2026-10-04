import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isSuspendedAllowedPath } from "@/lib/suspended-access";
import { isSuspendedPaymentAllowed } from "@/lib/tenant-guard";

describe("askıdaki ofis erişimi (P0-12)", () => {
  it("askıda: /app/askida ve /app/abonelik açık", () => {
    expect(isSuspendedAllowedPath("/app/askida", "suspended")).toBe(true);
    expect(isSuspendedAllowedPath("/app/abonelik", "suspended")).toBe(true);
    expect(isSuspendedAllowedPath("/app/abonelik/fatura/1", "suspended")).toBe(true);
  });

  it("askıda: diğer tüm /app yolları kapalı", () => {
    for (const p of ["/app", "/app/musteriler", "/app/ayarlar", "/app/abonelikler", "/app/ekip"]) {
      expect(isSuspendedAllowedPath(p, "suspended")).toBe(false);
    }
  });

  it("iptal: yalnız /app/askida açık, ödeme yolu kapalı", () => {
    expect(isSuspendedAllowedPath("/app/askida", "cancelled")).toBe(true);
    expect(isSuspendedAllowedPath("/app/abonelik", "cancelled")).toBe(false);
    expect(isSuspendedAllowedPath("/app/abonelik", null)).toBe(false);
  });

  it("ödeme action kapısı yalnız askıdaki ofise açılır", () => {
    expect(isSuspendedPaymentAllowed("suspended")).toBe(true);
    expect(isSuspendedPaymentAllowed("cancelled")).toBe(false);
    expect(isSuspendedPaymentAllowed("active")).toBe(false);
  });
});

describe("askıdaki ofis kapı sözleşmesi (kaynak taraması)", () => {
  it("middleware yol kuralını kullanır; yalnız ödeme action'ı allowSuspended ister", () => {
    const mw = readFileSync("src/lib/supabase/middleware.ts", "utf8");
    expect(mw).toContain("isSuspendedAllowedPath(path, tenant?.status)");
    expect(mw).not.toMatch(/startsWith\("\/app\/askida"\)/);

    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (
          /\.(ts|tsx)$/.test(name) &&
          !name.endsWith(".test.ts") &&
          readFileSync(p, "utf8").includes("allowSuspended: true")
        ) {
          users.push(p.replace(/\\/g, "/"));
        }
      }
    };
    walk("src");
    expect(users).toEqual(["src/app/actions/billing.ts"]);
  });
});
