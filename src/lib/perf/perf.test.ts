import { describe, expect, it } from "vitest";
import { STATIC_HTML_BUDGET, checkStaticHtmlBudget } from "./budgets";
import { classifyEncoding } from "./compression";
import { formatMetric, rateMetric, rateScore } from "./cwv";
import { measureHtml } from "./measure-html";
import { buildPsiUrl, parsePsiResult, runPsi, staticModeTag } from "./psi";

describe("hız bütçesi (F1)", () => {
  it("eşikler gzip 80 KB / ham 360 KB", () => {
    expect(STATIC_HTML_BUDGET).toEqual({ gzipKb: 80, rawKb: 360 });
    expect(checkStaticHtmlBudget({ gzipBytes: 80 * 1024, rawBytes: 360 * 1024 })).toEqual([]);
    expect(checkStaticHtmlBudget({ gzipBytes: 80 * 1024 + 1, rawBytes: 360 * 1024 + 1 }).map((v) => v.metric)).toEqual(["gzip", "raw"]);
  });
});

describe("HTML ölçümü", () => {
  it("Next betiklerini, dış ve satır içi betikleri sayar", () => {
    const m = measureHtml(
      '<script src="/_next/static/chunks/a.js"></script><script src="/statik/m.js" data-static-keep></script><script>1</script><script type="application/ld+json">{}</script>',
    );
    expect(m).toMatchObject({ nextScripts: 1, externalScripts: 2, inlineScripts: 2 });
    expect(m.gzipBytes).toBeGreaterThan(0);
  });
});

describe("sıkıştırma sınıflaması", () => {
  it("gzip → br önerilir; br/zstd iyi; yok → kötü", () => {
    expect(classifyEncoding("gzip")).toMatchObject({ tone: "warn", label: "gzip (br önerilir; operasyon onayı gerekir)" });
    expect(classifyEncoding("br").tone).toBe("ok");
    expect(classifyEncoding("zstd").tone).toBe("ok");
    expect(classifyEncoding(null).tone).toBe("bad");
  });
});

describe("PSI", () => {
  it("adres yalnız www.googleapis.com; anahtar yoksa key parametresi yok", () => {
    const u = new URL(buildPsiUrl("https://emlaksoft.com.tr/", "mobile", null));
    expect(u.hostname).toBe("www.googleapis.com");
    expect(u.searchParams.get("strategy")).toBe("mobile");
    expect(u.searchParams.has("key")).toBe(false);
    expect(new URL(buildPsiUrl("https://emlaksoft.com.tr/", "desktop", "K")).searchParams.get("key")).toBe("K");
  });

  it("yanıt çözümlemesi (eksik alan null)", () => {
    const m = parsePsiResult({
      lighthouseResult: {
        categories: { performance: { score: 0.93 } },
        audits: {
          "largest-contentful-paint": { numericValue: 1800.4 },
          "cumulative-layout-shift": { numericValue: 0.012 },
          "total-blocking-time": { numericValue: 40 },
          "network-requests": { details: { items: [{ resourceType: "Document", transferSize: 61000 }, { resourceType: "Script" }] } },
        },
      },
      loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 120 } } },
    });
    expect(m).toMatchObject({ score: 93, lcp_ms: 1800.4, cls: 0.012, tbt_ms: 40, ttfb_ms: null, requests: 2, html_gz: 61000, inp_ms: 120 });
    expect(parsePsiResult(null).score).toBeNull();
  });

  it("429 dürüst 'kota' durumuna çevrilir (anahtarsızken anahtar ekleme önerilir)", async () => {
    const fake = (async () => new Response("{}", { status: 429 })) as unknown as Parameters<typeof runPsi>[3];
    const r = await runPsi("https://emlaksoft.com.tr/", "mobile", null, fake);
    expect(r.status).toBe("quota");
    expect(r.status === "quota" && r.message).toMatch(/anahtar/);
  });

  it("statik mod etiketi", () => {
    expect(staticModeTag("on", true)).toBe("statik");
    expect(staticModeTag("on", false)).toBe("yedek");
    expect(staticModeTag("off", null)).toBe("normal");
  });
});

describe("CWV derecelendirme", () => {
  it("eşikler ve biçim", () => {
    expect(rateMetric("lcp_ms", 2400)).toBe("iyi");
    expect(rateMetric("cls", 0.2)).toBe("orta");
    expect(rateMetric("inp_ms", 600)).toBe("kotu");
    expect(rateMetric("tbt_ms", null)).toBeNull();
    expect(rateScore(95)).toBe("iyi");
    expect(formatMetric("lcp_ms", 1800)).toBe("1,8 sn");
    expect(formatMetric("tbt_ms", 40)).toBe("40 ms");
  });
});
