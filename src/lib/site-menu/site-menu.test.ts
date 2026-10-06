import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import snapshot from "./main-nav.snapshot.json";
import { platformCanAccess } from "@/lib/platform-access";
import { defaultSiteMenu } from "./defaults";
import { blankFeatured, blankGroup as blankGroupForTest, blankItem, moveInArray, moveItem } from "./editor-model";
import { MENU_ICON_LIST, isMenuIconName } from "./icon-registry";
import { HOME_ANCHORS, knownPublicPaths } from "./known-routes";
import { checkMenuMedia, MEDIA_LIMITS } from "./media";
import { endOfDayTrMs, toPublicMenu } from "./public";
import { LIMITS, checkHref, hasErrors, validateSiteMenu, type SiteMenuConfig } from "./schema";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function png(w: number, h: number, extra = 0): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(b.buffer).setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

describe("varsayılan menü (hiç override yokken site bugünkü gibi)", () => {
  const cfg = defaultSiteMenu();
  const { issues } = validateSiteMenu(cfg);

  it("hatasız doğrulanır ve bugünkü grup/bağlantı sayılarını taşır", () => {
    expect(hasErrors(issues)).toBe(false);
    expect(cfg.groups.map((g) => [g.id, g.kind, g.items.length])).toEqual([
      ["urun", "menu", 12],
      ["cozum", "menu", 6],
      ["kaynak", "menu", 6],
      ["fiyat", "menu", 4],
    ]);
    expect(cfg.footer.map((c) => c.title)).toEqual(["Ürün", "Paketler", "Kaynaklar", "Yasal", "İletişim"]);
    // Paket bağlantıları sabit değil: sütun `autoPlans` ile etkin plan tanımlarından beslenir.
    expect(cfg.footer[1]).toMatchObject({ autoPlans: true });
    expect(cfg.footer[1].links).toHaveLength(1);
    expect(cfg.announcement.enabled).toBe(false);
  });

  it("varsayılan uyarı üretmez (yinelenen hedef yok)", () => {
    expect(issues.filter((i) => i.level === "warn")).toEqual([]);
  });

  it("açık görünüm: tüm öğeler görünür, duyuru yok, dış bağlantı yok", () => {
    const pub = toPublicMenu(cfg, 0);
    expect(pub.groups).toHaveLength(4);
    expect(pub.groups.flatMap((g) => g.columns.flatMap((c) => c.items)).some((i) => i.external)).toBe(false);
    expect(pub.announcement).toBeNull();
    expect(pub.footer).toHaveLength(5);
  });

  it("her varsayılan ikon (bağlantı ve öne çıkan kart) kontrollü listede vardır", () => {
    for (const g of cfg.groups) {
      for (const it of g.items) if (it.icon.kind === "lucide") expect(isMenuIconName(it.icon.name), it.label).toBe(true);
      if (g.featured?.icon.kind === "lucide") expect(isMenuIconName(g.featured.icon.name), g.id).toBe(true);
    }
  });

  it("ana sayfa mega menüsüyle BİREBİR aynı: gruplar, sütun başlıkları, bağlantılar, ikonlar, öne çıkan kartlar", () => {
    expect(cfg.groups.map((g) => g.id)).toEqual(snapshot.map((g) => g.id));
    snapshot.forEach((sg, gi) => {
      const g = cfg.groups[gi];
      expect(g.label).toBe(sg.label);
      const expected = sg.columns.flatMap((c) => c.items.map((it) => ({ section: c.title, label: it.label, text: it.text, href: it.href, icon: it.icon })));
      const actual = g.items.map((it) => ({ section: it.section, label: it.label, text: it.text, href: it.href, icon: it.icon.kind === "lucide" ? it.icon.name : "" }));
      expect(actual).toEqual(expected);
      expect(g.featured).toMatchObject({
        eyebrow: sg.featured.eyebrow,
        title: sg.featured.title,
        text: sg.featured.text,
        href: sg.featured.href,
        ctaLabel: sg.featured.cta,
        icon: { kind: "lucide", name: sg.featured.icon },
        media: null,
      });
    });
  });

  it("açık görünümde sütunlar ana sayfa menüsündeki gibi bölünür", () => {
    expect(toPublicMenu(cfg, 0).groups.map((g) => g.columns.map((c) => c.title))).toEqual([
      ["Satış ve kazanç", "Otomasyon ve ofis"],
      ["Ofis büyüklüğüne göre", "Karar vermek için"],
      ["Öğrenin", "Yasal ve destek"],
      ["Fiyatlandırma"],
    ]);
  });
});

describe("bağlantı doğrulaması", () => {
  it("var olan yollar, bölüm bağlantıları, http(s), mailto ve tel kabul edilir", () => {
    for (const ok of ["/", "/fiyatlar", "/kayit?plan=office", "/#tur", "/araclar/komisyon-hesaplama", "https://example.com/a?b=1", "mailto:a@b.co", "tel:+905551112233"]) {
      expect(checkHref(ok).ok, ok).toBe(true);
    }
  });
  it("olmayan sayfa, olmayan bölüm ve tehlikeli şemalar reddedilir", () => {
    for (const bad of ["/olmayan-sayfa", "/#yok", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com", "/\\evil.com", "ftp://x.com/a", "", "   ", "https://user:pw@x.com", "https://localhost", "/fiyatlar x", "mailto:yok", "tel:abc"]) {
      expect(checkHref(bad).ok, bad).toBe(false);
    }
  });
  it("http uyarı verir", () => {
    const r = checkHref("http://example.com");
    expect(r.ok && r.warn).toBeTruthy();
  });
});

describe("anlamsal doğrulama", () => {
  const base = (): SiteMenuConfig => structuredClone(defaultSiteMenu());
  const media = [
    { id: "aaaaaaaaaaaa", type: "gif", kind: "animated" as const, bytes: 1000 },
    { id: "bbbbbbbbbbbb", type: "png", kind: "image" as const, bytes: 1000 },
    { id: "cccccccccccc", type: "mp4", kind: "video" as const, bytes: 1000 },
  ];

  it("olmayan sayfaya bağlantı hata verir", () => {
    const c = base();
    c.groups[0].items[0].href = "/yok";
    const { issues } = validateSiteMenu(c);
    expect(issues.find((i) => i.path === "groups.0.items.0.href")?.level).toBe("error");
  });

  it("uzunluk ve öğe sayısı sınırları", () => {
    const c = base();
    c.groups[0].items[0].label = "x".repeat(LIMITS.itemLabel + 1);
    expect(validateSiteMenu(c).config).toBeNull();
    const d = base();
    for (let i = 0; i < 9; i++) d.groups[1].items.push({ ...blankItem(`ek-${i}`), href: `/fiyatlar?x=${i}` });
    expect(validateSiteMenu(d).config).toBeNull();
    const e = base();
    e.groups = Array.from({ length: 6 }, (_, g) => ({
      ...blankGroupForTest(`g${g}`),
      items: Array.from({ length: 11 }, (_, i) => ({ ...blankItem(`i-${g}-${i}`), href: `/fiyatlar?x=${g}-${i}` })),
    }));
    expect(validateSiteMenu(e).issues.some((i) => i.path === "groups" && /en fazla/.test(i.message))).toBe(true);
  });

  it("boş grup ve yinelenen hedef uyarı verir (hata değil)", () => {
    const c = base();
    c.groups[1].items.forEach((i) => (i.hidden = true));
    c.groups[1].featured = null;
    c.groups[3].items[0].href = c.groups[3].items[1].href;
    const { issues } = validateSiteMenu(c);
    expect(issues.some((i) => i.level === "warn" && i.path === "groups.1")).toBe(true);
    expect(issues.some((i) => i.level === "warn" && i.path === "groups.3.items.1.href")).toBe(true);
    expect(hasErrors(issues)).toBe(false);
  });

  it("yinelenen kimlik hata", () => {
    const c = base();
    c.groups[0].items[1].id = c.groups[0].items[0].id;
    expect(hasErrors(validateSiteMenu(c).issues)).toBe(true);
  });

  it("öne çıkan kart: poster, en-boy oranı ve medya varlığı zorunlu", () => {
    const c = base();
    c.groups[1].featured = { ...blankFeatured(), media: { mediaId: "aaaaaaaaaaaa", kind: "animated", posterId: null, ratio: "16:9", alt: "x" } };
    expect(validateSiteMenu(c, { media }).issues.some((i) => i.path.endsWith("posterId") && i.level === "error")).toBe(true);
    c.groups[1].featured.media!.posterId = "bbbbbbbbbbbb";
    expect(hasErrors(validateSiteMenu(c, { media }).issues)).toBe(false);
    c.groups[1].featured.media!.posterId = "cccccccccccc"; // video poster olamaz
    expect(hasErrors(validateSiteMenu(c, { media }).issues)).toBe(true);
    c.groups[1].featured.media!.posterId = "bbbbbbbbbbbb";
    c.groups[1].featured.media!.mediaId = "dddddddddddd"; // yok
    expect(hasErrors(validateSiteMenu(c, { media }).issues)).toBe(true);
    // geçersiz oran şemada reddedilir
    const bad = JSON.parse(JSON.stringify(c)) as SiteMenuConfig;
    (bad.groups[1].featured!.media as { ratio: string }).ratio = "7:3";
    expect(validateSiteMenu(bad, { media }).config).toBeNull();
  });

  it("logo medyası yalnız durağan olabilir; bilinmeyen ikon reddedilir", () => {
    const c = base();
    c.groups[0].items[0].icon = { kind: "media", mediaId: "aaaaaaaaaaaa" };
    expect(hasErrors(validateSiteMenu(c, { media }).issues)).toBe(true);
    c.groups[0].items[0].icon = { kind: "media", mediaId: "bbbbbbbbbbbb" };
    expect(hasErrors(validateSiteMenu(c, { media }).issues)).toBe(false);
    c.groups[0].items[0].icon = { kind: "lucide", name: "OlmayanIkon" };
    expect(hasErrors(validateSiteMenu(c, { media }).issues)).toBe(true);
  });

  it("duyuru: açıkken metin, bağlantı varsa bağlantı metni zorunlu", () => {
    const c = base();
    c.announcement = { enabled: true, key: "k", text: "", href: "", linkLabel: "", endsOn: "", dismissible: true };
    expect(hasErrors(validateSiteMenu(c).issues)).toBe(true);
    c.announcement.text = "Yeni özellik";
    c.announcement.href = "/fiyatlar";
    expect(hasErrors(validateSiteMenu(c).issues)).toBe(true);
    c.announcement.linkLabel = "İncele";
    expect(hasErrors(validateSiteMenu(c).issues)).toBe(false);
  });

  it("şema fazladan alanı reddeder (strict)", () => {
    const c = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    c.extra = 1;
    expect(validateSiteMenu(c).config).toBeNull();
  });
});

describe("herkese açık görünüm", () => {
  it("gizli öğe/grup/sütun ve geçersiz bağlantı ayıklanır; boş grup düşer", () => {
    const c = defaultSiteMenu();
    c.groups[0].items[0].hidden = true;
    c.groups[1].hidden = true;
    c.groups[3].items.forEach((i) => (i.hidden = true));
    c.groups[3].featured = null;
    c.footer[0].hidden = true;
    c.groups[0].items[1].href = "javascript:alert(1)";
    const pub = toPublicMenu(c, 0);
    expect(pub.groups.map((g) => g.id)).toEqual(["urun", "kaynak"]);
    expect(pub.groups[0].columns.flatMap((c) => c.items)).toHaveLength(10);
    expect(pub.footer.map((f) => f.id)).not.toContain("urun");
  });

  it("dış bağlantı işaretlenir; rozet ve medya adresi taşınır", () => {
    const c = defaultSiteMenu();
    c.groups[1].items[0] = { ...c.groups[1].items[0], href: "https://example.com/x", badge: "yeni" };
    c.groups[1].featured = { ...blankFeatured(), media: { mediaId: "aaaaaaaaaaaa", kind: "animated", posterId: "bbbbbbbbbbbb", ratio: "4:3", alt: "a" } };
    const g = toPublicMenu(c, 0).groups.find((x) => x.id === "cozum")!;
    expect(g.columns[0].items[0]).toMatchObject({ external: true, badge: "yeni" });
    expect(g.featured?.media).toMatchObject({ src: "/site-menu-asset/aaaaaaaaaaaa", posterSrc: "/site-menu-asset/bbbbbbbbbbbb", ratio: "4:3" });
  });

  it("duyuru bitiş tarihi Türkiye gününün sonuna kadar geçerlidir", () => {
    const c = defaultSiteMenu();
    c.announcement = { enabled: true, key: "k", text: "Duyuru", href: "", linkLabel: "", endsOn: "2026-10-05", dismissible: true };
    const end = endOfDayTrMs("2026-10-05")!;
    expect(toPublicMenu(c, end - 1000).announcement?.text).toBe("Duyuru");
    expect(toPublicMenu(c, end + 1000).announcement).toBeNull();
    c.announcement.enabled = false;
    expect(toPublicMenu(c, 0).announcement).toBeNull();
  });
});

describe("editör modeli", () => {
  it("moveInArray ve moveItem (grup içi ve gruplar arası)", () => {
    expect(moveInArray([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    const c = defaultSiteMenu();
    const within = moveItem(c, "urun-tur", { kind: "item", id: "urun-ai-asistan" });
    expect(within.groups[0].items[7].id).toBe("urun-tur");
    const across = moveItem(c, "urun-tur", { kind: "group", id: "kaynak" });
    expect(across.groups[0].items).toHaveLength(11);
    expect(across.groups[2].items.at(-1)?.id).toBe("urun-tur");
    const withLink = structuredClone(c);
    withLink.groups.push({ ...blankGroupForTest("lnk"), kind: "link", href: "/fiyatlar" });
    expect(moveItem(withLink, "urun-tur", { kind: "group", id: "lnk" })).toBe(withLink); // doğrudan bağlantı grubuna bırakılamaz
    expect(c.groups[0].items[0].id).toBe("urun-tur"); // girdi değişmedi
  });
});

describe("medya yükleme doğrulaması", () => {
  it("PNG, GIF, WebP animasyonu, WebM ve MP4 türü içerikten belirlenir", () => {
    expect(checkMenuMedia("image", png(64, 64))).toMatchObject({ ok: true, type: "png", kind: "image" });
    const gif = new Uint8Array(40);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 64, 0, 64, 0], 0);
    expect(checkMenuMedia("featured", gif)).toMatchObject({ ok: true, type: "gif", kind: "animated", w: 64, h: 64 });
    expect(checkMenuMedia("image", gif)).toMatchObject({ ok: false });
    const webp = new Uint8Array(40);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 0);
    webp[20] = 0x02; // animasyon bayrağı
    webp[24] = 99; // genişlik 100
    webp[27] = 49; // yükseklik 50
    expect(checkMenuMedia("featured", webp)).toMatchObject({ ok: true, type: "webp", kind: "animated", w: 100, h: 50 });
    const webm = new Uint8Array(100);
    webm.set([0x1a, 0x45, 0xdf, 0xa3], 0);
    expect(checkMenuMedia("featured", webm)).toMatchObject({ ok: true, type: "webm", kind: "video" });
    const mp4 = new Uint8Array(100);
    mp4.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 0);
    expect(checkMenuMedia("featured", mp4)).toMatchObject({ ok: true, type: "mp4", kind: "video" });
    expect(checkMenuMedia("icon", mp4)).toMatchObject({ ok: false });
  });

  it("boyut tavanları: video/animasyon 2 MB, durağan 400 KB, ikon 200 KB", () => {
    const bigVideo = new Uint8Array(MEDIA_LIMITS.motionBytes + 1);
    bigVideo.set([0x1a, 0x45, 0xdf, 0xa3], 0);
    expect(checkMenuMedia("featured", bigVideo)).toMatchObject({ ok: false });
    const okVideo = new Uint8Array(MEDIA_LIMITS.motionBytes);
    okVideo.set([0x1a, 0x45, 0xdf, 0xa3], 0);
    expect(checkMenuMedia("featured", okVideo).ok).toBe(true);
    expect(checkMenuMedia("image", png(64, 64, MEDIA_LIMITS.stillBytes)).ok).toBe(false);
    expect(checkMenuMedia("icon", png(64, 64, MEDIA_LIMITS.iconBytes)).ok).toBe(false);
  });

  it("piksel ölçü sınırları ve ikon üst sınırı", () => {
    expect(checkMenuMedia("image", png(8, 8)).ok).toBe(false);
    expect(checkMenuMedia("image", png(4000, 100)).ok).toBe(false);
    expect(checkMenuMedia("icon", png(600, 600)).ok).toBe(false);
    expect(checkMenuMedia("icon", png(512, 512)).ok).toBe(true);
  });

  it("SVG: betik, olay özniteliği ve foreignObject reddedilir; temiz SVG kabul edilir", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const clean = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';
    expect(checkMenuMedia("icon", enc(clean))).toMatchObject({ ok: true, type: "svg", encoding: "text" });
    for (const bad of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
    ]) {
      expect(checkMenuMedia("icon", enc(bad)).ok, bad).toBe(false);
    }
  });

  it("rastgele ikili ve boş dosya reddedilir", () => {
    expect(checkMenuMedia("icon", new Uint8Array(0)).ok).toBe(false);
    expect(checkMenuMedia("icon", new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x81, 0x00, 0x00])).ok).toBe(false);
  });
});

describe("bilinen yollar gerçek sayfalara karşılık gelir", () => {
  const appDir = join(process.cwd(), "src", "app");
  it("her bilinen yolun page.tsx dosyası vardır (dinamik araç sayfaları dahil)", () => {
    for (const p of knownPublicPaths()) {
      const segs = p.split("/").filter(Boolean);
      const direct = join(appDir, ...segs, "page.tsx");
      const dynamic = segs.length === 2 ? join(appDir, segs[0], "[slug]", "page.tsx") : "";
      expect(existsSync(direct) || (dynamic !== "" && existsSync(dynamic)) || p === "/", p).toBe(true);
    }
    expect(existsSync(join(appDir, "page.tsx"))).toBe(true);
  });

  it("her ana sayfa bölüm bağlantısı ana sayfa kaynağında gerçek bir id'dir", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.tsx$/.test(e)) files.push(f);
      }
    };
    walk(join(process.cwd(), "src", "components", "marketing"));
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n") + read("src/app/page.tsx");
    for (const a of HOME_ANCHORS) {
      expect(new RegExp(`(id="${a}"|id: "${a}"|id=\\{"${a}"\\})`).test(src), a).toBe(true);
    }
  });

  it("ikon listesi aranabilir etiketlerle gelir", () => {
    expect(MENU_ICON_LIST.length).toBeGreaterThan(60);
    expect(MENU_ICON_LIST.every((i) => i.label && i.keywords)).toBe(true);
  });
});

describe("sözleşme: yetki, kayıt ve önbellek", () => {
  const actions = read("src/app/actions/site-menu.ts");

  it("her action süper admin yazar kapısından geçer; sert güvenlik/yeni admin istemcisi yok", () => {
    const exported = actions.match(/export async function \w+/g) ?? [];
    expect(exported.length).toBe(6);
    expect(actions.match(/await requireWriter\(\)/g)?.length).toBe(exported.length);
    expect(actions).toContain('requirePlatformModule("sitemenu")');
    expect(actions).toContain('staff.role === "super_admin"');
    expect(actions).not.toContain("createAdminClient");
    expect(actions.match(/logPlatformActivity\(/g)?.length).toBeGreaterThanOrEqual(exported.length);
    expect(actions).toContain("updateTag(SITE_MENU_CACHE_TAG)");
    expect(actions).toContain("checkRateLimit");
  });

  it("'use server' dosyası yalnız async fonksiyon (ve tür) dışa aktarır", () => {
    expect(actions.startsWith('"use server"')).toBe(true);
    const exports = actions.match(/^export .*/gm) ?? [];
    for (const e of exports) expect(e.startsWith("export async function") || e.startsWith("export type"), e).toBe(true);
  });

  it("admin sayfası okuma kapısı ile açılır; ops okur, destek/muhasebe okuyamaz", () => {
    expect(read("src/app/admin/site-menu/page.tsx")).toContain('requirePlatformModule("sitemenu")');
    expect(platformCanAccess("super_admin", "sitemenu")).toBe(true);
    expect(platformCanAccess("ops", "sitemenu")).toBe(true);
    expect(platformCanAccess("support", "sitemenu")).toBe(false);
    expect(platformCanAccess("billing", "sitemenu")).toBe(false);
    expect(read("src/lib/admin/nav.ts")).toContain('L("/admin/site-menu", "Site menüsü", "Menü, alt bilgi, duyuru şeridi", ["sitemenu"])');
  });

  it("yayın medya rotası SVG'yi sandbox/nosniff ile sunar ve Range destekler", () => {
    const route = read("src/app/site-menu-asset/[id]/route.ts");
    expect(route).toContain("sandbox");
    expect(route).toContain("nosniff");
    expect(route).toContain("206");
  });

  it("herkese açık üst bar sunucuda okunur; istemciye ikon paketi girmez", () => {
    const header = read("src/components/site-header.tsx");
    const client = read("src/components/site-menu/mega-menu.tsx");
    expect(header.startsWith('"use client"')).toBe(false);
    expect(header).toContain("getLiveSiteMenu");
    expect(client.startsWith('"use client"')).toBe(true);
    expect(client).not.toContain("icon-registry");
    expect(client).not.toContain("@/lib/site-menu/store");
    expect(client).toContain('aria-label="Ana site navigasyonu"');
    expect(client).toContain('aria-label="Mobil site navigasyonu"');
  });

  it("hareket: yalnız transform/opacity, reduced-motion ve Save-Data'da poster", () => {
    const css = read("src/app/marketing-sections.css");
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).toContain("--motion-stagger");
    const media = read("src/components/site-menu/featured-media.tsx");
    expect(media).toContain("saveData");
    expect(media).toContain("prefers-reduced-motion: reduce");
    expect(media).toContain("active ?");
  });
});
