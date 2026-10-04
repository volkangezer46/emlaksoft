import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SAMPLE_DATA_LABEL,
  SAMPLE_KPI_THRESHOLD,
  buildSampleKpiScope,
  loadSampleKpiScope,
  sampleDataHint,
} from "./sample-scope";

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

describe("buildSampleKpiScope (tek KPI kapsamı)", () => {
  it("eşik altı + örnek yüklü: dahil, etiketli, süzgeç eklemez", () => {
    const s = buildSampleKpiScope({ realCustomers: 1, realProperties: 2 }, true);
    expect(s.include).toBe(true);
    expect(s.label).toBe(SAMPLE_DATA_LABEL);
    expect(s.values).toEqual([false, true]);
    const r = recorder();
    s.apply(r.proxy);
    expect(r.calls).toEqual([]);
  });
  it("eşik altı ama örnek hiç yüklenmemiş: etiket yok", () => {
    const s = buildSampleKpiScope({ realCustomers: 0, realProperties: 0 }, false);
    expect(s.include).toBe(true);
    expect(s.label).toBeNull();
  });
  it("eşikte: örnek dışlanır, etiket yok, is_sample=false eklenir", () => {
    const t = SAMPLE_KPI_THRESHOLD;
    const s = buildSampleKpiScope({ realCustomers: t, realProperties: 0 }, true);
    expect(s.include).toBe(false);
    expect(s.label).toBeNull();
    expect(s.values).toEqual([false]);
    const r = recorder();
    s.apply(r.proxy);
    expect(r.calls).toEqual([["eq", "is_sample", false]]);
  });
  it("açıklama eşiği söyler", () => {
    expect(sampleDataHint()).toContain(String(SAMPLE_KPI_THRESHOLD));
  });
});

describe("loadSampleKpiScope", () => {
  const fake = (real: number, seededAt: string | null) => ({
    from: (table: string) => ({
      select: (_cols: string, opts?: unknown) => {
        if (table === "tenants") {
          const one = { maybeSingle: async () => ({ data: { sample_seeded_at: seededAt } }) };
          return { eq: () => one, limit: () => one };
        }
        void opts;
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.is = async () => ({ count: real });
        return chain;
      },
    }),
  });
  it("gerçek sayı eşik altı ve tohum varsa etiket döner", async () => {
    const s = await loadSampleKpiScope(fake(2, "2026-01-01"), "t1");
    expect(s.include).toBe(true);
    expect(s.label).toBe(SAMPLE_DATA_LABEL);
  });
  it("gerçek sayı eşikte ise örnek dışlanır", async () => {
    const s = await loadSampleKpiScope(fake(SAMPLE_KPI_THRESHOLD, "2026-01-01"), null);
    expect(s.include).toBe(false);
    expect(s.label).toBeNull();
  });
});

/** Ofis KPI yüzeyleri merkezi kapsamı kullanmak ZORUNDA (kopya eşik/sorgu yasak). */
const KPI_SURFACES = [
  "src/app/app/page.tsx",
  "src/lib/team/advisor-metrics.ts",
  "src/lib/tv/tv-data.ts",
  "src/app/app/raporlar/page.tsx",
  "src/lib/office-score.ts",
];

describe("KPI yüzeyleri sample-scope kullanır", () => {
  for (const rel of KPI_SURFACES) {
    it(`${rel}: loadSampleKpiScope / SampleKpiScope kullanır, eşiği kopyalamaz`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(/sample-scope/.test(src), `${rel} sample-scope import etmiyor`).toBe(true);
      expect(/SAMPLE_KPI_THRESHOLD\s*=/.test(src)).toBe(false);
    });
  }
});
