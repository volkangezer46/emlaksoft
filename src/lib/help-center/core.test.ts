import { describe, expect, it } from "vitest";
import { GUIDES, matchesQuery } from "@/lib/help-content";
import { FAQ } from "@/lib/help-faq";
import { selectFaqForQuestion } from "@/lib/ai/faq-context";
import { codeDraft, helpArticleExists, mergeHelpContent, slugify, stepsFromBody, validateHelpDraft, type HelpArticleRow } from "./core";

const row = (over: Partial<HelpArticleRow>): HelpArticleRow => ({
  id: "x",
  kind: "faq",
  slug: "yeni-soru",
  status: "published",
  title: "Portföy fotoğrafına filigran nasıl eklenir?",
  summary: "",
  body: "Ayarlar > Vitrin sekmesinden filigranı açın; yeni yüklenen fotoğraflara otomatik eklenir.",
  category: "kayitlar",
  href: "/app/ayarlar",
  hrefLabel: "Ayarlar",
  sort: 100,
  draft: null,
  publishedAt: "2026-10-13T10:00:00Z",
  updatedAt: "2026-10-13T10:00:00Z",
  ...over,
});

describe("yardım merkezi birleşimi", () => {
  it("DB yoksa koddaki içerik aynen", () => {
    const m = mergeHelpContent([]);
    expect(m.guides).toEqual([...GUIDES]);
    expect(m.faq).toEqual([...FAQ]);
  });

  it("yayınlanan yeni makale hemen listede ve aramada (ve AI SSS seçiminde) bulunur", () => {
    const m = mergeHelpContent([row({})]);
    const hit = m.faq.find((f) => f.id === "yeni-soru");
    expect(hit?.category).toBe("kayitlar");
    expect(m.faq.filter((f) => matchesQuery([f.q, f.a], "filigran")).map((f) => f.id)).toContain("yeni-soru");
    expect(selectFaqForQuestion("fotoğrafa filigran nasıl eklenir", m.faq, 2, 2).map((x) => x.item.id)).toContain("yeni-soru");
  });

  it("taslak ve bekleyen düzenleme okuyucuya gitmez", () => {
    expect(mergeHelpContent([row({ status: "draft" })]).faq.some((f) => f.id === "yeni-soru")).toBe(false);
    const withDraft = mergeHelpContent([row({ draft: { title: "GİZLİ", summary: "", body: "x", category: null, href: null, hrefLabel: null } })]);
    expect(withDraft.faq.find((f) => f.id === "yeni-soru")?.q).not.toBe("GİZLİ");
  });

  it("aynı slug kodu geçersiz kılar; hidden kod maddesini gizler; sıra korunur", () => {
    const first = FAQ[0]!;
    const over = mergeHelpContent([row({ slug: first.id, title: "Yeni soru metni" })]);
    expect(over.faq[0]!.q).toBe("Yeni soru metni");
    expect(over.faq).toHaveLength(FAQ.length);
    const hidden = mergeHelpContent([row({ slug: first.id, status: "hidden" })]);
    expect(hidden.faq.some((f) => f.id === first.id)).toBe(false);
  });

  it("rehber adımları satırlardan; koddan taslak gidiş-dönüş kayıpsız", () => {
    expect(stepsFromBody("1. Bir\n\n- İki\n  Üç  ")).toEqual(["Bir", "İki", "Üç"]);
    const g = GUIDES[0]!;
    const d = codeDraft("guide", g.slug)!;
    const merged = mergeHelpContent([row({ kind: "guide", slug: g.slug, ...d })]);
    expect(merged.guides[0]).toEqual({ ...g, steps: [...g.steps] });
  });

  it("doğrulama ve slug önerisi", () => {
    expect(validateHelpDraft("faq", { title: "", summary: "", body: "x", category: null, href: null, hrefLabel: null })).toMatch(/Başlık/);
    expect(validateHelpDraft("faq", { title: "a", summary: "", body: "x", category: null, href: "//evil", hrefLabel: null })).toMatch(/site içi/);
    expect(validateHelpDraft("faq", { title: "a", summary: "", body: "x", category: null, href: "/\\evil.com", hrefLabel: null })).toMatch(/site içi/);
    expect(validateHelpDraft("faq", { title: "a", summary: "", body: "x", category: null, href: "/app/x\\y", hrefLabel: null })).toMatch(/site içi/);
    expect(validateHelpDraft("guide", { title: "a", summary: "", body: "  ", category: null, href: null, hrefLabel: null })).toMatch(/adım/);
    expect(slugify("Şube & Çalışan İzinleri?")).toBe("sube-calisan-izinleri");
  });
});

describe("oy öncesi makale varlık denetimi", () => {
  it("kod ve yayındaki DB makalesi var; rastgele slug ve gizlenen kod makalesi yok", () => {
    const merged = mergeHelpContent([row({})]);
    expect(helpArticleExists(merged, "faq", "yeni-soru")).toBe(true);
    expect(helpArticleExists(merged, "guide", GUIDES[0]!.slug)).toBe(true);
    expect(helpArticleExists(merged, "faq", "rastgele-uydurma-slug")).toBe(false);
    const hidden = mergeHelpContent([row({ kind: "guide", slug: GUIDES[0]!.slug, status: "hidden" })]);
    expect(helpArticleExists(hidden, "guide", GUIDES[0]!.slug)).toBe(false);
  });
});
