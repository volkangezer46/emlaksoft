import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Herkese açık rehber sayfaları: yazı sayfası geçerli Article + BreadcrumbList JSON-LD basar, sayfada istemci betiği
 * yoktur (yalnız application/ld+json), yayında yazı yokken /rehber noindex ve "Yakında" gösterir. Depo taklittir.
 */
type Entry = import("@/lib/guides/schema").GuideIndexEntry;
type Content = import("@/lib/guides/schema").GuideContent;

const h = vi.hoisted(() => ({ index: [] as Entry[], contents: new Map<string, Content>() }));

vi.mock("@/components/tools/tools-shell", () => ({ ToolsShell: ({ children }: { children: unknown }) => children }));
vi.mock("@/lib/seo/store", async () => {
  const { resolvePageMetadata } = await import("@/lib/seo/metadata");
  const { DEFAULT_SEO_GLOBAL } = await import("@/lib/seo/schema");
  return { buildMetadata: async (path: string, extra?: object) => resolvePageMetadata(path, DEFAULT_SEO_GLOBAL, {}, extra) };
});
vi.mock("@/lib/guides/store", () => ({
  getPublishedGuideIndex: async () => h.index,
  getLiveGuide: async (id: string) => h.contents.get(id) ?? null,
  listPublishedGuidesForPage: async () => h.index.flatMap((entry) => (h.contents.has(entry.id) ? [{ entry, content: h.contents.get(entry.id)! }] : [])),
}));

import { extractJsonLdBlocks, validateJsonLd } from "@/lib/seo/jsonld";
import GuideHubPage, { generateMetadata as hubMetadata } from "./page";
import GuidePage, { generateMetadata as guideMetadata } from "./[slug]/page";
import GuideCategoryPage, { generateMetadata as categoryMetadata } from "./kategori/[k]/page";
import { GET as rss } from "./rss.xml/route";

const entry: Entry = {
  id: "aaaaaaaaaaaa",
  slug: "kira-getirisi-nasil-hesaplanir",
  title: "Kira getirisi nasıl hesaplanır?",
  category: "finans-ve-vergi",
  status: "yayinda",
  publishedAt: "2026-10-10T09:00:00.000Z",
  firstPublishedAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-10T09:00:00.000Z",
  updatedBy: "Test",
};
const content: Content = {
  title: "Kira getirisi nasıl hesaplanır?",
  category: "finans-ve-vergi",
  seo: { title: "Kira getirisi hesaplama", description: "Brüt ve net kira getirisi adım adım." },
  body: [
    { type: "p", text: `**Kira getirisi** yatırımın ölçüsüdür. ${"söz ".repeat(320)}` },
    { type: "h2", text: "Brüt getiri" },
    { type: "p", text: "<script>alert(1)</script> [araç](/araclar/kira-getirisi-hesaplama)" },
    { type: "h2", text: "Net getiri" },
    { type: "faq", items: [{ q: "Net getiri nedir?", a: "Giderler düşülmüş getiridir." }] },
    { type: "toolEmbed", slug: "kira-getirisi-hesaplama" },
  ],
  relatedTools: ["komisyon-hesaplama"],
};

const render = async (el: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await el);

beforeEach(() => {
  h.index = [];
  h.contents.clear();
});

describe("/rehber/[slug]", () => {
  it("Article ve BreadcrumbList JSON-LD geçerli; istemci betiği yok, ham HTML kaçışlı", async () => {
    h.index = [entry];
    h.contents.set(entry.id, content);
    const html = await render(GuidePage({ params: Promise.resolve({ slug: entry.slug }) }));

    const { blocks, parseErrors } = extractJsonLdBlocks(html);
    expect(parseErrors).toBe(0);
    expect(blocks).toHaveLength(1);
    expect(validateJsonLd(blocks[0])).toEqual([]);
    const types = ((blocks[0] as { "@graph": Array<{ "@type": string }> })["@graph"]).map((n) => n["@type"]);
    expect(types).toEqual(expect.arrayContaining(["Article", "BreadcrumbList", "FAQPage"]));

    // Tek <script> JSON-LD'dir; istemci paketi/satır içi JS yok.
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toEqual(['<script type="application/ld+json">']);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('id="brut-getiri"');
    expect(html).toContain('href="#net-getiri"');
    expect(html).toContain("İlgili araçlar");
    expect(html).toMatch(/\d+ dk okuma/);
  });

  it("metadata: canonical yazı yolu; ince içerik noindex", async () => {
    h.index = [entry];
    h.contents.set(entry.id, content);
    const md = await guideMetadata({ params: Promise.resolve({ slug: entry.slug }) });
    expect(md.alternates?.canonical).toMatch(/\/rehber\/kira-getirisi-nasil-hesaplanir$/);
    expect(md.robots).toBeUndefined();
    h.contents.set(entry.id, { ...content, body: [{ type: "p", text: "kısa" }] });
    expect((await guideMetadata({ params: Promise.resolve({ slug: entry.slug }) })).robots).toEqual({ index: false, follow: true });
  });

  it("yayında olmayan ya da geçersiz yol 404", async () => {
    await expect(GuidePage({ params: Promise.resolve({ slug: "yok" }) })).rejects.toThrow();
    await expect(GuidePage({ params: Promise.resolve({ slug: "../admin" }) })).rejects.toThrow();
  });
});

describe("/rehber ve kategori", () => {
  it("yayında yazı yokken /rehber noindex ve 'Yakında'", async () => {
    expect((await hubMetadata()).robots).toEqual({ index: false, follow: true });
    const html = await render(GuideHubPage());
    expect(html).toContain("Yakında");
    expect(html).not.toMatch(/<script/i);
  });

  it("yayında yazı varsa indekslenir ve listelenir", async () => {
    h.index = [entry];
    h.contents.set(entry.id, content);
    expect((await hubMetadata()).robots).toBeUndefined();
    expect(await render(GuideHubPage())).toContain('href="/rehber/kira-getirisi-nasil-hesaplanir"');
  });

  it("boş kategori noindex; dolu kategori yazıyı listeler", async () => {
    h.index = [entry];
    h.contents.set(entry.id, content);
    expect((await categoryMetadata({ params: Promise.resolve({ k: "ofis-yonetimi" }) })).robots).toEqual({ index: false, follow: true });
    expect((await categoryMetadata({ params: Promise.resolve({ k: "finans-ve-vergi" }) })).robots).toBeUndefined();
    expect(await render(GuideCategoryPage({ params: Promise.resolve({ k: "finans-ve-vergi" }) }))).toContain(entry.title);
  });

  it("RSS yanıtı XML içerik türünde ve yazıyı içerir", async () => {
    h.index = [entry];
    h.contents.set(entry.id, content);
    const res = await rss();
    expect(res.headers.get("Content-Type")).toContain("application/rss+xml");
    expect(await res.text()).toContain("<link>");
  });
});

describe("sözleşme: rehber sayfalarında istemci kodu yok", () => {
  const ROOT = process.cwd();
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(relative(ROOT, full).split("\\").join("/"));
    }
    return out;
  };
  const files = [...walk(join(ROOT, "src/app/rehber")), ...walk(join(ROOT, "src/lib/guides")), ...walk(join(ROOT, "src/lib/rich-text"))];

  it("'use client', next/link, next/dynamic, next/script ve smart-link yok", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src.trimStart().startsWith('"use client"'), f).toBe(false);
      expect(src, f).not.toMatch(/from "next\/(link|dynamic|script)"/);
      expect(src, f).not.toContain("smart-link");
    }
  });

  it("dangerouslySetInnerHTML yalnız yazı sayfasındaki serializeJsonLd çıktısında", () => {
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), "utf8");
      const uses = src.match(/dangerouslySetInnerHTML=\{\{[^}]*\}\}/g) ?? [];
      if (f === "src/app/rehber/[slug]/page.tsx") expect(uses).toEqual(["dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}"]);
      else expect(uses, f).toEqual([]);
    }
  });
});
