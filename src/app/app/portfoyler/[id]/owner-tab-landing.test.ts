import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTab } from "@/components/app/detail-tabs";

/**
 * B053 kilidi: kayıt sonrası iniş ve yayın kapısı yönlendirmesi `?sekme=sahip` kullanır. Sekme kimliği detay
 * sayfasının çözümleme listesinde yoksa `resolveTab` sessizce "ozet"e düşer ve İlan sahibi sekmesi hiç açılmaz.
 */
const page = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("portföy detayı İlan sahibi sekmesi", () => {
  it("PROPERTY_TAB_IDS 'sahip' içerir ve ?sekme=sahip çözülür", () => {
    const m = page.match(/const PROPERTY_TAB_IDS = \[([^\]]+)\] as const;/);
    expect(m).not.toBeNull();
    const ids = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(ids).toContain("sahip");
    expect(resolveTab({ sekme: "sahip" }, ids, "ozet")).toBe("sahip");
  });

  it("her sekme tanımı çözümleme listesinde de var (tıklanan sekme özet'e düşmez)", () => {
    const m = page.match(/const PROPERTY_TAB_IDS = \[([^\]]+)\] as const;/);
    const ids = new Set([...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    const tabDefs = [...page.matchAll(/\{ id: "([a-z]+)", label: /g)].map((x) => x[1]);
    expect(tabDefs.length).toBeGreaterThan(0);
    for (const t of tabDefs) expect(ids.has(t)).toBe(true);
  });

  it("yayın kapısı yönlendirmesinde neden sekmede gösterilir", () => {
    expect(page).toMatch(/sp\.yayin === "eksik"/);
    expect(page).toMatch(/publishBlockReason\(supabase, tenantId, property\.id\)/);
  });
});
