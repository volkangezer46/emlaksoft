import { describe, expect, it } from "vitest";
import { NEVER_INDEX_MAX_EXTRA, parseNeverIndexInput, resolveNeverIndexList } from "./never-index";

describe("parseNeverIndexInput (yönetim formu)", () => {
  it("virgül/satır ayrımlı slug'ları küçültür, tekrarsız ve sıralı döner; varsayılanları saklamaz", () => {
    const r = parseNeverIndexInput("Beta-Ofis, alfa\n beta-ofis ; demo-ofis");
    expect(r).toEqual({ ok: true, slugs: ["alfa", "beta-ofis"] });
  });
  it("boş girdi geçerlidir (yalnız varsayılanlar kalır)", () => {
    expect(parseNeverIndexInput("  ")).toEqual({ ok: true, slugs: [] });
  });
  it("geçersiz öğe sessizce atılmaz: hata döner", () => {
    const r = parseNeverIndexInput("iyi-ofis, kötü/ofis");
    expect(r.ok).toBe(false);
  });
  it("üst sınır aşılırsa reddeder", () => {
    const many = Array.from({ length: NEVER_INDEX_MAX_EXTRA + 1 }, (_, i) => `ofis-${i}`).join(",");
    expect(parseNeverIndexInput(many).ok).toBe(false);
  });
  it("kaydedilen JSON okuyucuda aynı listeyi verir (varsayılanlar dahil)", () => {
    const r = parseNeverIndexInput("alfa");
    if (!r.ok) throw new Error("beklenmeyen hata");
    expect(resolveNeverIndexList(JSON.stringify(r.slugs))).toContain("alfa");
    expect(resolveNeverIndexList(JSON.stringify(r.slugs))).toContain("demo-ofis");
  });
});

describe("seo.vitrin.never_index ayar kaydı", () => {
  it("JSON dizi biçimini de kabul eder (geçmiş sürüme dönüş)", () => {
    expect(parseNeverIndexInput('["b","a"]')).toEqual({ ok: true, slugs: ["a", "b"] });
    expect(parseNeverIndexInput("[1]").ok).toBe(false);
  });
  it("köprü ayarıdır: merkezden yazılamaz, köprüden normalize JSON saklanır", async () => {
    const { prepareWrite } = await import("@/lib/settings/prepare");
    expect(prepareWrite({ key: "seo.vitrin.never_index", value: "a", reason: "deneme amaçlı" }).ok).toBe(false);
    const r = prepareWrite({ key: "seo.vitrin.never_index", value: "B, a", reason: "deneme amaçlı", fromBridge: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.formatted).toBe('["a","b"]');
    expect(prepareWrite({ key: "seo.vitrin.never_index", value: "a/b", reason: "deneme amaçlı", fromBridge: true }).ok).toBe(false);
  });
});
