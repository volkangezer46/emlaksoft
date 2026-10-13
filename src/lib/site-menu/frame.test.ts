import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { addDismissed, announcementKey, endOfDayTrMs, matchesPath, parseDismissed, pickAnnouncement, startOfDayTrMs, readUtm, withUtm, type AnnouncementTarget } from "./announcements";
import { defaultSiteMenu } from "./defaults";
import { customCtas, splitYear, toPublicAnnouncements, toPublicCtas } from "./public";
import { checkHref, checkPageHref, hasErrors, siteMenuSchema, upgradeSiteMenu, validateSiteMenu, type SiteMenuConfig } from "./schema";

// Çerçeve çıktısı golden'ı: yayın yokken (varsayılan yapılandırma) alt bilgi, üst bar ve 404 HTML'i birebir aynı kalmalı.
const live = vi.hoisted(() => ({ cfg: null as unknown }));
vi.mock("@/lib/site-menu/store", async () => {
  const d = await import("./defaults");
  return { getLiveSiteMenu: async () => live.cfg ?? d.defaultSiteMenu() };
});
vi.mock("@/lib/billing/plan-definitions", async () => {
  const mod = await import("@/lib/billing/plans");
  return { getPublicPlanDefinitions: async () => mod.PLANS };
});
vi.mock("@/lib/seo/store", () => ({
  getSeoSettings: async () => ({
    global: { organization: { name: "EmlakSoft", legalName: "", logo: "", sameAs: ["https://www.instagram.com/emlaksoft"], email: "destek@emlaksoft.com.tr", phone: "05321234567" } },
  }),
}));
vi.mock("@/lib/clock", async (orig) => {
  const mod = await orig<typeof import("@/lib/clock")>();
  // Sabit an: 2026-10-13 12:00 (TR). Golden yıl ve tarihe bağlı olmasın.
  const fixed = Date.parse("2026-10-13T12:00:00+03:00");
  return { ...mod, now: () => fixed, trParts: (v?: number) => mod.trParts(v ?? fixed) };
});

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import NotFound from "@/app/not-found";

async function html(el: ReactElement | Promise<ReactElement>): Promise<string> {
  return renderToString(await el);
}

const T = (over: Partial<AnnouncementTarget> & { id: string }): AnnouncementTarget => ({
  startsAtMs: null,
  endsAtMs: null,
  pathMode: "all",
  pathPrefix: "",
  priority: 5,
  ...over,
});

describe("şema: eski kayıtlar yükseltilir", () => {
  const legacy = () => {
    const c = defaultSiteMenu() as unknown as Record<string, unknown>;
    for (const k of ["footerBrand", "ctas", "announcements", "ogCard", "notFound"]) delete c[k];
    c.announcement = { enabled: false, key: "0", text: "", href: "", linkLabel: "", endsOn: "", dismissible: true };
    return c;
  };

  it("duyurusuz eski yapılandırma varsayılanla eşdeğer okunur", () => {
    const res = siteMenuSchema.safeParse(legacy());
    expect(res.success).toBe(true);
    expect(res.data).toEqual(defaultSiteMenu());
  });

  it("açık tekil duyuru → announcements[{id:'legacy'}]; kapalı duyuru listeye girmez", () => {
    const c = legacy();
    c.announcement = { enabled: true, key: "abc", text: "Bakım var", href: "/fiyatlar", linkLabel: "İncele", endsOn: "2026-10-20", dismissible: false };
    const cfg = siteMenuSchema.parse(c);
    expect(cfg.announcements).toEqual([
      { id: "legacy", text: "Bakım var", href: "/fiyatlar", linkLabel: "İncele", startsOn: "", endsOn: "2026-10-20", pathMode: "all", pathPrefix: "", priority: 5, dismissible: false },
    ]);
    expect("announcement" in cfg).toBe(false);
    expect(validateSiteMenu(c).config?.announcements[0].id).toBe("legacy");
  });

  it("yükseltme girdiyi değiştirmez; yeni kayıt olduğu gibi kalır", () => {
    const c = legacy();
    const before = JSON.stringify(c);
    upgradeSiteMenu(c);
    expect(JSON.stringify(c)).toBe(before);
    const fresh = defaultSiteMenu();
    fresh.ogCard.title = "Yeni başlık";
    expect(siteMenuSchema.parse(fresh).ogCard.title).toBe("Yeni başlık");
  });

  it("varsayılan çerçeve hatasız ve uyarısız doğrulanır", () => {
    const { issues } = validateSiteMenu(defaultSiteMenu());
    expect(hasErrors(issues)).toBe(false);
    expect(issues.filter((i) => i.level === "warn")).toEqual([]);
  });
});

describe("bağlantı kuralları", () => {
  it("javascript:/data: ve çerçevede mailto/http reddedilir; site yolu ve https kabul", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", " javascript:alert(1)"]) {
      expect(checkHref(bad).ok, bad).toBe(false);
      expect(checkPageHref(bad).ok, bad).toBe(false);
    }
    expect(checkPageHref("mailto:a@b.co").ok).toBe(false);
    expect(checkPageHref("http://example.com").ok).toBe(false);
    expect(checkPageHref("https://example.com/x").ok).toBe(true);
    expect(checkPageHref("/kayit?plan=office&utm_source=ig&utm_campaign=ekim").ok).toBe(true);
  });

  it("javascript: bağlantılı yapılandırma kaydedilemez (hata)", () => {
    const paths: Array<[string, (c: SiteMenuConfig) => void]> = [
      ["ctas.trial.href", (c) => (c.ctas.trial.href = "javascript:alert(1)")],
      ["footerBrand.cta.href", (c) => (c.footerBrand.cta.href = "javascript:alert(1)")],
      ["notFound.links.0.href", (c) => (c.notFound.links[0].href = "javascript:alert(1)")],
      [
        "announcements.0.href",
        (c) =>
          (c.announcements = [{ id: "a1", text: "x", href: "javascript:alert(1)", linkLabel: "y", startsOn: "", endsOn: "", pathMode: "all", pathPrefix: "", priority: 5, dismissible: true }]),
      ],
    ];
    for (const [path, mutate] of paths) {
      const c = defaultSiteMenu();
      mutate(c);
      const { issues } = validateSiteMenu(c);
      expect(issues.some((i) => i.level === "error" && i.path === path), path).toBe(true);
    }
  });

  it("sınırlar ve tarih/yol kuralları", () => {
    const c = defaultSiteMenu();
    c.announcements = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, text: "x", href: "", linkLabel: "", startsOn: "", endsOn: "", pathMode: "all" as const, pathPrefix: "", priority: 5, dismissible: true }));
    expect(validateSiteMenu(c).config).toBeNull();
    c.announcements = [{ id: "a1", text: "x", href: "", linkLabel: "", startsOn: "2026-10-10", endsOn: "2026-10-01", pathMode: "prefix", pathPrefix: "fiyatlar", priority: 5, dismissible: true }];
    const paths = validateSiteMenu(c).issues.filter((i) => i.level === "error").map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["announcements.0.endsOn", "announcements.0.pathPrefix"]));
    c.footerBrand.badges = Array.from({ length: 5 }, () => ({ label: "x", icon: "check" as const }));
    expect(validateSiteMenu(c).config).toBeNull();
  });

  it("riskli iddia uyarır ama engellemez", () => {
    const c = defaultSiteMenu();
    c.ogCard.title = "Türkiye'nin en iyi emlak yazılımı";
    const { issues } = validateSiteMenu(c, { media: [], risky: (v) => (/en iyi/.test(v) ? ["en iyi"] : []) });
    expect(issues.find((i) => i.path === "ogCard.title")?.level).toBe("warn");
    expect(hasErrors(issues)).toBe(false);
  });
});

describe("pickAnnouncement (Türkiye günü, yol, öncelik, kapatma)", () => {
  const today = Date.parse("2026-10-13T12:00:00+03:00");
  const tomorrow = startOfDayTrMs("2026-10-14");
  const list = [
    T({ id: "genel", priority: 3 }),
    T({ id: "ana", pathMode: "home", priority: 6 }),
    T({ id: "fiyat", pathMode: "prefix", pathPrefix: "/fiyatlar", priority: 7 }),
    T({ id: "yarin", startsAtMs: tomorrow, priority: 9 }),
    T({ id: "dun", endsAtMs: endOfDayTrMs("2026-10-12"), priority: 9 }),
  ];
  const cases: Array<[string, string, readonly string[], string | null]> = [
    ["/", "bugün", [], "ana"],
    ["/fiyatlar", "bugün", [], "fiyat"],
    ["/fiyatlar/", "bugün", [], "fiyat"],
    ["/fiyatlarx", "bugün", [], "genel"],
    ["/araclar", "bugün", [], "genel"],
    ["/", "bugün", ["ana"], "genel"],
    ["/", "bugün", ["ana", "genel"], null],
  ];
  for (const [path, , dismissed, expected] of cases) {
    it(`${path} · kapatılan [${dismissed.join(",")}] → ${expected}`, () => {
      expect(pickAnnouncement(list, path, today, dismissed)?.id ?? null).toBe(expected);
    });
  }

  it("başlangıcı yarın olan bugün görünmez, yarın 00:00 TR'de görünür; bitişi dün olan görünmez", () => {
    expect(pickAnnouncement([list[3]], "/", today)).toBeNull();
    expect(pickAnnouncement([list[3]], "/", tomorrow! - 1)).toBeNull();
    expect(pickAnnouncement([list[3]], "/", tomorrow!)?.id).toBe("yarin");
    expect(pickAnnouncement([list[4]], "/", today)).toBeNull();
    expect(pickAnnouncement([list[4]], "/", endOfDayTrMs("2026-10-12")!)?.id).toBe("dun");
  });

  it("eşit öncelikte listedeki sıra; yalnız '/' hedefli duyuru /fiyatlar'da görünmez", () => {
    expect(pickAnnouncement([T({ id: "a" }), T({ id: "b" })], "/x", today)?.id).toBe("a");
    expect(pickAnnouncement([T({ id: "ana", pathMode: "home" })], "/fiyatlar", today)).toBeNull();
    expect(matchesPath({ pathMode: "prefix", pathPrefix: "/araclar/" }, "/araclar/kredi")).toBe(true);
  });

  it("yayın görünümü: süresi dolan ayıklanır, başlamayan kalır; anahtar içerik değişince değişir", () => {
    const c = defaultSiteMenu();
    const base = { href: "", linkLabel: "", pathMode: "all" as const, pathPrefix: "", priority: 5, dismissible: true };
    c.announcements = [
      { ...base, id: "a1", text: "Yarın", startsOn: "2026-10-14", endsOn: "" },
      { ...base, id: "a2", text: "Bitti", startsOn: "", endsOn: "2026-10-12" },
      { ...base, id: "a3", text: "Kötü bağlantı", href: "javascript:alert(1)", linkLabel: "x", startsOn: "", endsOn: "" },
    ];
    const pub = toPublicAnnouncements(c.announcements, today);
    expect(pub.map((a) => a.text)).toEqual(["Yarın", "Kötü bağlantı"]);
    expect(pub[1].href).toBe("");
    expect(pickAnnouncement(pub, "/", today)?.text).toBe("Kötü bağlantı");
    expect(announcementKey("a1", ["x"])).not.toBe(announcementKey("a1", ["y"]));
    expect(announcementKey("a1", ["x"]).startsWith("a1-")).toBe(true);
  });

  it("kapatma listesi: eski tekil anahtar okunur, en çok 8 anahtar tutulur", () => {
    expect(parseDismissed("eskianahtar")).toEqual(["eskianahtar"]);
    let raw = "";
    for (let i = 0; i < 10; i++) raw = addDismissed(raw, `k${i}`);
    expect(parseDismissed(raw)).toEqual(["k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9"]);
    expect(addDismissed("a b", "a")).toBe("b a");
  });
});

describe("UTM oluşturucu ve düğmeler", () => {
  it("plan, utm_source ve utm_campaign eklenir; bölüm korunur; boş değer siler", () => {
    expect(withUtm("/kayit", { plan: "office", source: "Instagram", campaign: "Ekim Kampanyası" })).toBe("/kayit?plan=office&utm_source=instagram&utm_campaign=ekim-kampanyasi");
    expect(withUtm("/fiyatlar?x=1#sss", { source: "ig" })).toBe("/fiyatlar?x=1&utm_source=ig#sss");
    expect(withUtm("/kayit?plan=office", { plan: "" })).toBe("/kayit");
    expect(checkPageHref(withUtm("/kayit", { plan: "office", source: "İğüşöç", campaign: "a b" })).ok).toBe(true);
  });

  it("oluşturucu mevcut değerlerle açılır: yalnız bir alanı değiştirmek diğerlerini silmez", () => {
    expect(readUtm("/kayit?plan=office&utm_campaign=ekim#x")).toEqual({ plan: "office", source: "", campaign: "ekim" });
    expect(readUtm("/kayit")).toEqual({ plan: "", source: "", campaign: "" });
    const cur = readUtm("/kayit?plan=office");
    expect(withUtm("/kayit?plan=office", { ...cur, source: "ig" })).toBe("/kayit?plan=office&utm_source=ig");
  });

  it("varsayılan düğmeler istemciye geçmez; geçersiz hedef varsayılana düşer", () => {
    const c = defaultSiteMenu();
    expect(customCtas(c.ctas)).toBeNull();
    c.ctas.trial = { label: "Hemen başla", href: "/kayit?utm_source=ig" };
    c.ctas.login.href = "javascript:alert(1)";
    expect(toPublicCtas(c.ctas)).toMatchObject({ trial: { label: "Hemen başla", href: "/kayit?utm_source=ig" }, login: { label: "Giriş yap", href: "/giris" } });
    expect(splitYear("© {yil} X", 2026)).toEqual(["© ", 2026, " X"]);
  });
});

describe("çerçeve çıktısı (golden)", () => {
  it("varsayılan yapılandırmada alt bilgi, üst bar ve 404 bugünkü HTML ile birebir aynı", async () => {
    live.cfg = null;
    const out = [
      await html(SiteFooter({ smartCta: true, trialDays: 30 })),
      await html(SiteFooter()),
      await html(SiteHeader()),
      await html(NotFound() as ReactElement | Promise<ReactElement>),
    ].join("\n\n");
    await expect(out).toMatchFileSnapshot("./__golden__/frame-default.html");
  });

  it("yönetimden gelen değerler çıktıya yansır (alt bilgi, düğmeler, mobil alt çubuk, duyuru, 404)", async () => {
    const c = defaultSiteMenu();
    c.footerBrand.description = "Yeni açıklama";
    c.footerBrand.badges[0].label = "Yeni rozet";
    c.footerBrand.showContact = true;
    c.footerBrand.copyright = "{yil} © Biz";
    c.ctas.trial = { label: "Hemen başla", href: "/kayit?plan=office&utm_source=ig" };
    c.ctas.mobileTrial = { label: "Dene", href: "/kayit?utm_source=mobil" };
    c.announcements = [
      { id: "a1", text: "Yalnız ana sayfa", href: "", linkLabel: "", startsOn: "", endsOn: "", pathMode: "home", pathPrefix: "", priority: 5, dismissible: true },
      { id: "a2", text: "Yarın başlar", href: "", linkLabel: "", startsOn: "2026-10-14", endsOn: "", pathMode: "all", pathPrefix: "", priority: 9, dismissible: true },
    ];
    c.notFound.links = [{ label: "Blog yok", desc: "", href: "https://example.com/yardim" }];
    live.cfg = c;
    try {
      const footer = await html(SiteFooter({ trialDays: 30 }));
      expect(footer).toContain("Yeni açıklama");
      expect(footer).toContain("Yeni rozet");
      expect(footer).toContain('href="mailto:destek@emlaksoft.com.tr"');
      expect(footer).toContain("Instagram");
      expect(footer).toContain("2026<!-- --> © Biz");
      expect(footer).toContain('href="/kayit?utm_source=mobil"');
      expect(footer).toMatch(/class="mk-btn mk-btn-grad"[^>]*>Dene</);
      const header = await html(SiteHeader());
      expect(header).toContain("Hemen başla");
      expect(header).toContain('href="/kayit?plan=office&amp;utm_source=ig"');
      // Yol bağlamı yok (test) → "/" sayılır: ana sayfa duyurusu görünür, yarın başlayan görünmez.
      expect(header).toContain("Yalnız ana sayfa");
      expect(header).not.toContain("Yarın başlar");
      expect(header).toContain('data-ann="true"');
      const nf = await html(NotFound() as ReactElement | Promise<ReactElement>);
      expect(nf).toContain("Blog yok");
      expect(nf).not.toContain("Ücretsiz deneyin");
    } finally {
      live.cfg = null;
    }
  });
});
