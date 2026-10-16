import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PREFILL_ALIASES, prefillHref, readPrefillContext } from "./prefill-params";

/**
 * Sözleşme (sahip: "anlaşma başlat deyince müşteriyi otomatik seçmiyor"): bir kayıttan (müşteri 360, portföy, talep,
 * anlaşma, eşleştirme, sözleşme) açılan her "yeni" bağlantısı o kaydın kimliğini taşır ve hedef sayfa onu ortak
 * yardımcıyla (src/lib/prefill-params.ts) okuyup ön seçer.
 */

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** Bağlam ekranları: buradaki oluşturma bağlantıları bağlamsız olamaz. */
const CONTEXT_SOURCES = [
  "src/app/app/musteriler/[id]/customer-360-tabs.tsx",
  "src/app/app/musteriler/[id]/page.tsx",
  "src/app/app/portfoyler/[id]/page.tsx",
  "src/app/app/talepler/[id]/page.tsx",
  "src/app/app/talepler/matching-view.tsx",
  "src/app/app/anlasmalar/[id]/page.tsx",
  "src/app/app/sozlesmeler/[id]/page.tsx",
];

/** Bağlam kabul eden oluşturma sayfaları → okuduğu yardımcı. */
const CREATE_PAGES: Record<string, { page: string; reads: "ids" | "context" }> = {
  "/app/randevular/yeni": { page: "src/app/app/randevular/yeni/page.tsx", reads: "context" },
  "/app/anlasmalar/yeni": { page: "src/app/app/anlasmalar/yeni/page.tsx", reads: "context" },
  "/app/teklifler/yeni": { page: "src/app/app/teklifler/yeni/page.tsx", reads: "context" },
  "/app/gorevler/yeni": { page: "src/app/app/gorevler/yeni/page.tsx", reads: "context" },
  "/app/sozlesmeler/yeni": { page: "src/app/app/sozlesmeler/yeni/page.tsx", reads: "ids" },
  "/app/kiralama/yeni": { page: "src/app/app/kiralama/yeni/page.tsx", reads: "ids" },
  "/app/talepler/yeni": { page: "src/app/app/talepler/yeni/page.tsx", reads: "ids" },
  "/app/acik-ev/yeni": { page: "src/app/app/acik-ev/yeni/page.tsx", reads: "ids" },
  "/app/portfoyler/yeni": { page: "src/app/app/portfoyler/yeni/page.tsx", reads: "ids" },
  "/app/portfoyler/sunumlar/yeni": { page: "src/app/app/portfoyler/sunumlar/yeni/page.tsx", reads: "ids" },
};

const CREATE_RE = /\/app\/(?:randevular|anlasmalar|teklifler|gorevler|sozlesmeler|kiralama|talepler|acik-ev|portfoyler(?:\/sunumlar)?)\/yeni/;

describe("bağlamlı oluşturma bağlantıları", () => {
  it.each(CONTEXT_SOURCES)("%s: oluşturma bağlantısı bağlam kimliği taşır", (file) => {
    const src = read(file);
    const offenders: string[] = [];
    src.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) return;
      for (const m of line.matchAll(/(["'`])(\/app\/[^"'`]*?\/yeni)([^"'`]*)\1/g)) {
        if (!CREATE_RE.test(m[2])) continue;
        const before = line.slice(0, m.index);
        const viaHelper = /prefillHref\(\s*$/.test(before);
        const templated = m[1] === "`" && /\?[^`]*\$\{/.test(m[3]);
        if (!viaHelper && !templated) offenders.push(`${i + 1}: ${t.slice(0, 140)}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  it.each(CONTEXT_SOURCES)("%s: prefillHref çağrısı en az bir kimlik verir", (file) => {
    const src = read(file);
    for (const m of src.matchAll(/prefillHref\(\s*"([^"]+)",\s*\{([^}]*)\}/g)) {
      expect(m[2], `${file}: ${m[1]}`).toMatch(/customerId|propertyId|demandId|dealId/);
    }
  });

  it.each(CONTEXT_SOURCES)("%s: \"Randevu ver\" oluşturma formuna gider (listeye değil)", (file) => {
    const lines = read(file).split("\n");
    lines.forEach((line, i) => {
      if (!/>\s*Randevu ver\s*</.test(line) && !/label: "Randevu ver"/.test(line) && !/<\/?\w+[^>]*\/> Randevu ver/.test(line)) return;
      const window = lines.slice(Math.max(0, i - 10), i + 1).join("\n");
      expect(window, `${file}:${i + 1}`).toMatch(/randevular\/yeni|newApptHref/);
    });
  });

  it("talep / anlaşma kimliği yalnız onu okuyan sayfaya gönderilir", () => {
    for (const file of CONTEXT_SOURCES) {
      const src = read(file);
      for (const m of src.matchAll(/prefillHref\(\s*"([^"]+)",\s*\{([^}]*)\}/g)) {
        if (!/demandId|dealId/.test(m[2])) continue;
        const target = CREATE_PAGES[m[1]];
        expect(target, `${file}: ${m[1]}`).toBeDefined();
        expect(target!.reads, `${file}: ${m[1]} talep/anlaşma bağlamını okumuyor`).toBe("context");
      }
    }
  });
});

describe("oluşturma sayfaları bağlamı ortak yardımcıyla okur", () => {
  it.each(Object.entries(CREATE_PAGES))("%s", (_route, { page, reads }) => {
    const src = read(page);
    expect(src).toContain('from "@/lib/prefill-params"');
    expect(src).toMatch(reads === "context" ? /readPrefillContext\(/ : /readPrefill(?:Ids|Context)\(/);
  });

  it("anlaşma formu ön seçimi seçicilere verir (müşteri + portföy)", () => {
    const form = read("src/app/app/anlasmalar/yeni/new-deal-form.tsx");
    expect(form).toContain("defaultValue={defaultCustomerId}");
    expect(form).toContain("defaultValue={defaultPropertyId}");
  });
});

describe("readPrefillContext / prefillHref", () => {
  const C = "11111111-1111-4111-8111-111111111111";
  const D = "33333333-3333-4333-8333-333333333333";
  const A = "44444444-4444-4444-8444-444444444444";

  it("talep ve anlaşma eş adlarını okur; bozuk değeri yok sayar", () => {
    expect(readPrefillContext({ musteri: C, talep: D, anlasma: A })).toEqual({ customerId: C, propertyId: null, demandId: D, dealId: A });
    expect(readPrefillContext({ demand: "x", deal: "1;drop" })).toEqual({ customerId: null, propertyId: null, demandId: null, dealId: null });
  });

  it("kanonik adlarla bağlantı üretir", () => {
    expect(prefillHref("/app/randevular/yeni", { customerId: C, demandId: D, dealId: A })).toBe(
      `/app/randevular/yeni?customer=${C}&demand=${D}&deal=${A}`,
    );
  });

  it("her eş ad grubunda kanonik ad önce", () => {
    for (const [key, names] of Object.entries(PREFILL_ALIASES)) expect(names[0]).toBe(key);
  });
});
