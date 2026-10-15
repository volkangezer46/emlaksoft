import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AG_TABS, agTabHref, parseAgTab, parseSharedKind } from "./ag-tabs";

describe("Ağ sekmeleri (OA11)", () => {
  it("en çok 5 sekme; bilinmeyen sekme havuza düşer", () => {
    expect(AG_TABS.length).toBeLessThanOrEqual(5);
    expect(parseAgTab(undefined)).toBe("havuz");
    expect(parseAgTab("yok")).toBe("havuz");
    expect(parseAgTab("onerilerim")).toBe("onerilerim");
    expect(parseSharedKind("talep")).toBe("talep");
    expect(parseSharedKind("x")).toBe("ilan");
  });

  it("bağlantılar varsayılan sekmede sade, ek sorgu korunur", () => {
    expect(agTabHref("havuz")).toBe("/app/ag");
    expect(agTabHref("havuz", { talep: "abc", bos: "" })).toBe("/app/ag?talep=abc");
    expect(agTabHref("paylastiklarim", { tur: "talep" })).toBe("/app/ag?sekme=paylastiklarim&tur=talep");
  });

  it("sayfa sekme şeridi kullanır ve eski alt alta bölüm çapalarına bağlantı vermez", () => {
    const src = readFileSync(join(process.cwd(), "src/app/app/ag/page.tsx"), "utf8");
    expect(src).toContain("<SegmentTabs");
    expect(src).not.toMatch(/href="#(paylastiklarim|taleplerim|paylastigim-talepler|talep-yanitlarim)"/);
  });
});
