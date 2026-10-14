import { describe, expect, it } from "vitest";
import { coverageRate, parseGrowthFunnel, parsePeriod, pctText, periodRange, rate } from "./funnel";
import { landingLinks, landingTable } from "./landing";

describe("huni çözümleyici", () => {
  it("geçersiz gövde null", () => {
    expect(parseGrowthFunnel(null)).toBeNull();
    expect(parseGrowthFunnel([])).toBeNull();
    expect(parseGrowthFunnel({ from: "x", to: "2026-10-13" })).toBeNull();
  });

  it("bozuk sayılar null olur (sıfır uydurulmaz), tanınmayan kanal atılır", () => {
    const f = parseGrowthFunnel({
      from: "2026-09-16",
      to: "2026-10-13",
      has_pageviews: true,
      measure_started: "2026-10-13",
      channels: [
        { channel: "organic_search", visits: "12", signups: 3, activated: 1, paid: 0, median_days_to_paid: null, paid_samples: 0 },
        { channel: "bilinmiyor", visits: null, signups: 2, activated: 0, paid: 0, median_days_to_paid: -4 },
        { channel: "hacker", visits: 1, signups: 1 },
        "bozuk",
      ],
      totals: { signups: 5, attributed: 3, activated: 1, paid: 0 },
      visits_total: 12,
      landings: [{ path: "/", visits: 12, signups: 3, paid: 0 }, { path: "", visits: 1 }],
    })!;
    expect(f.channels.map((c) => c.channel)).toEqual(["organic_search", "bilinmiyor"]);
    expect(f.channels[0]).toMatchObject({ visits: 12, label: "Organik arama", medianDaysToPaid: null });
    expect(f.channels[1]).toMatchObject({ visits: null, medianDaysToPaid: null, label: "Atıfsız kayıt" });
    expect(f.landings).toHaveLength(1);
    expect(coverageRate(f)).toBeCloseTo(0.6);
  });

  it("oran: payda 0/null → null; yüzde metni", () => {
    expect(rate(1, 0)).toBeNull();
    expect(rate(1, null)).toBeNull();
    expect(rate(null, 4)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
    expect(pctText(0.125)).toBe("%12,5");
    expect(pctText(null)).toBe("—");
  });

  it("dönem: 7/28/90, varsayılan 28; önceki dönem bitişik", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("90")).toBe(90);
    expect(parsePeriod("30")).toBe(28);
    expect(parsePeriod(undefined)).toBe(28);
    const r = periodRange(7, Date.parse("2026-10-13T10:00:00Z"));
    expect(r.cur).toEqual({ from: "2026-10-07", to: "2026-10-13" });
    expect(r.prev).toEqual({ from: "2026-09-30", to: "2026-10-06" });
    // TR gece yarısından sonra (UTC 21:30) gün TR'ye göre ilerler.
    expect(periodRange(1, Date.parse("2026-10-13T21:30:00Z")).cur.to).toBe("2026-10-14");
  });
});

describe("iniş yolu bağlantıları", () => {
  const pages = [{ id: "p1", slug: "hakkimizda" }];
  it("her yoldan içerik editörüne ve SEO kaydına", () => {
    expect(landingLinks("/", pages).content?.href).toBe("/admin/site/sayfalar/ana-sayfa");
    expect(landingLinks("/fiyatlar", pages).content?.href).toBe("/admin/site/sayfalar/fiyatlar");
    expect(landingLinks("/hakkimizda", pages).content?.href).toBe("/admin/site/sayfalar/p1");
    expect(landingLinks("/araclar", pages).content?.href).toBe("/admin/site/sayfalar");
    expect(landingLinks("/hakkimizda", pages).seo.href).toBe("/admin/site/seo?sekme=sayfalar&sayfa=%2Fhakkimizda#editor");
    expect(landingLinks("/vitrin/[ofis]", pages)).toEqual({ content: null, seo: { href: "/admin/site/seo?sekme=kaliplar", label: "SEO kalıbı" } });
  });

  it("tablo: ziyarete göre sıralı, kayıt oranı payda 0'da null", () => {
    const t = landingTable(
      [
        { path: "/a", visits: 0, signups: 0, paid: 0 },
        { path: "/", visits: 10, signups: 1, paid: 0 },
        { path: "/b", visits: null, signups: 2, paid: 1 },
      ],
      [],
    );
    expect(t.map((r) => r.path)).toEqual(["/", "/a", "/b"]);
    expect(t[0]!.signupRate).toBe(0.1);
    expect(t[1]!.signupRate).toBeNull();
    expect(t[2]!.signupRate).toBeNull();
  });
});
