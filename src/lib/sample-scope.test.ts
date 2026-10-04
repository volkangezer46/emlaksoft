import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SAMPLE_KPI_THRESHOLD,
  includeSample,
  isSampleRecipient,
  isSampleCampaignRecipient,
  isSampleCustomer,
  notSample,
  publicPropertyFilter,
  sampleValues,
  applySampleScope,
} from "./sample-scope";

/** Zincirleme çağrıları kaydeden sahte sorgu kurucusu. */
function recorder() {
  const calls: [string, ...unknown[]][] = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop: string) => (...args: unknown[]) => {
        calls.push([prop, ...args]);
        return proxy;
      },
    },
  );
  return { proxy, calls };
}

describe("includeSample (KPI eşiği)", () => {
  it("gerçek kayıt yokken demo dahil", () => {
    expect(includeSample({ realCustomers: 0, realProperties: 0 })).toBe(true);
  });
  it("eşiğin hemen altında dahil, eşikte dışlanır", () => {
    const t = SAMPLE_KPI_THRESHOLD;
    expect(includeSample({ realCustomers: t - 1, realProperties: t - 1 })).toBe(true);
    expect(includeSample({ realCustomers: t, realProperties: 0 })).toBe(false);
    expect(includeSample({ realCustomers: 0, realProperties: t })).toBe(false);
  });
  it("geçersiz sayıları 0 sayar", () => {
    expect(includeSample({ realCustomers: Number.NaN, realProperties: -3 })).toBe(true);
  });
  it("sampleValues ve applySampleScope", () => {
    expect(sampleValues(true)).toEqual([false, true]);
    expect(sampleValues(false)).toEqual([false]);
    const a = recorder();
    applySampleScope(a.proxy, true);
    expect(a.calls).toEqual([]);
    const b = recorder();
    applySampleScope(b.proxy, false);
    expect(b.calls).toEqual([["eq", "is_sample", false]]);
  });
});

describe("public süzgeçler", () => {
  it("notSample is_sample=false ekler", () => {
    const r = recorder();
    notSample(r.proxy);
    expect(r.calls).toEqual([["eq", "is_sample", false]]);
  });
  it("publicPropertyFilter live + silinmemiş + demo değil", () => {
    const r = recorder();
    publicPropertyFilter(r.proxy);
    expect(r.calls).toEqual([
      ["eq", "status", "live"],
      ["is", "deleted_at", null],
      ["eq", "is_sample", false],
    ]);
  });
});

describe("dış gönderim engeli", () => {
  it("isSampleRecipient yalnız true için engeller", () => {
    expect(isSampleRecipient({ is_sample: true })).toBe(true);
    expect(isSampleRecipient({ is_sample: false })).toBe(false);
    expect(isSampleRecipient(null)).toBe(false);
  });
  const client = (tables: Record<string, unknown>) => ({
    from: (t: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: tables[t] ?? null, error: null }) }),
      }),
    }),
  });
  it("demo müşteri ve kampanya alıcısı algılanır", async () => {
    const c = client({ customers: { is_sample: true }, campaign_recipients: { customer_id: "c1" } });
    expect(await isSampleCustomer(c, "c1")).toBe(true);
    expect(await isSampleCampaignRecipient(c, "r1")).toBe(true);
  });
  it("gerçek müşteri engellenmez", async () => {
    const c = client({ customers: { is_sample: false }, campaign_recipients: { customer_id: "c1" } });
    expect(await isSampleCampaignRecipient(c, "r1")).toBe(false);
    expect(await isSampleCustomer(c, null)).toBe(false);
  });
  it("gönderim motorları demo kapısını içerir (kaynak sözleşmesi)", () => {
    const root = process.cwd();
    const campaign = readFileSync(join(root, "src/lib/campaign-delivery.ts"), "utf8");
    expect(campaign).toContain("isSampleCampaignRecipient");
    expect(campaign.indexOf("isSampleCampaignRecipient(admin")).toBeLessThan(campaign.indexOf("await sendToProvider("));
    const auto = readFileSync(join(root, "src/lib/automation-engine.ts"), "utf8");
    expect(auto).toContain("isSampleRecipient(customer)");
  });
});

/** Public yüzey dosyaları: her properties sorgusu merkezi demo süzgecinden geçmeli. */
const PUBLIC_FILES = [
  "src/app/vitrin/[slug]/page.tsx",
  "src/app/vitrin/[slug]/opengraph-image.tsx",
  "src/app/vitrin/[slug]/[id]/page.tsx",
  "src/app/vitrin/[slug]/[id]/opengraph-image.tsx",
  "src/lib/seo/sitemap-data.ts",
  "src/app/sunum/[token]/page.tsx",
  "src/app/paylas/[token]/page.tsx",
  "src/app/danisman/[slug]/page.tsx",
  "src/app/malik-portali/[token]/page.tsx",
  "src/app/musteri-portali/[token]/page.tsx",
  "src/app/acik-ev-kayit/[token]/page.tsx",
  "src/app/degerleme-raporu/[token]/page.tsx",
  "src/app/api/vitrin-favoriler/route.ts",
];

describe("public yüzeylerde demo süzgeci sözleşmesi", () => {
  for (const rel of PUBLIC_FILES) {
    it(`${rel}: her from("properties") is_sample süzgeci taşır`, () => {
      const lines = readFileSync(join(process.cwd(), rel), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/from\("properties"\)/.test(line)) return;
        const stmt = lines.slice(i, i + 25).join("\n");
        // ifade bir sonraki "await/const" başlangıcına kadar
        const end = stmt.search(/\n\s*(const|let|if|return)\s/);
        const body = end > 0 ? stmt.slice(0, end) : stmt;
        expect(
          /is_sample", false\)|publicPropertyFilter\(|notSample\(/.test(body),
          `${rel}:${i + 1} properties sorgusunda is_sample süzgeci yok`,
        ).toBe(true);
      });
    });
  }
});
