import { describe, expect, it } from "vitest";
import { buildVitrinManifest } from "./vitrin-manifest";

describe("vitrin manifest (PUB-10)", () => {
  it("uses office name/color/logo scoped to the vitrin", () => {
    const m = buildVitrinManifest({ name: "Deniz Gayrimenkul Danışmanlık", slug: "deniz", brandColor: "#0a7d5a", logoUrl: "https://cdn.example.com/l.png" });
    expect(m.name).toBe("Deniz Gayrimenkul Danışmanlık");
    expect(m.short_name).toBe("Deniz");
    expect(m.start_url).toBe("/vitrin/deniz");
    expect(m.scope).toBe("/vitrin/deniz/");
    expect(m.theme_color).toBe("#0a7d5a");
    expect(m.icons[0].src).toBe("https://cdn.example.com/l.png");
    expect(JSON.stringify(m)).not.toContain("EmlakSoft");
  });

  it("falls back to a neutral icon and theme; rejects unsafe logo/color", () => {
    const m = buildVitrinManifest({ name: null, slug: "x", brandColor: "red;", logoUrl: "javascript:alert(1)" });
    expect(m.name).toBe("Emlak ofisi");
    expect(m.theme_color).toBe("#334155");
    expect(m.icons.map((i) => i.src)).toEqual(["/brand/vitrin-neutral-192.png", "/brand/vitrin-neutral-512.png"]);
  });
});
