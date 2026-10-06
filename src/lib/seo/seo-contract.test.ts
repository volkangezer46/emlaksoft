import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";
import { ALWAYS_DISALLOW, NEVER_INDEX_PREFIXES, seoPages } from "./registry";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const TOKEN_SURFACES = [
  "malik-portali/[token]",
  "musteri-portali/[token]",
  "randevu-teyit/[token]",
  "randevu-al/[token]",
  "paylas/[token]",
  "sunum/[token]",
  "tavsiye/[token]",
  "imza/[token]",
  "degerleme-raporu/[token]",
  "anket/[token]",
  "odeme-link/[token]",
  "acik-ev-kayit/[token]",
  "lead/[token]",
];

describe("SEO sözleşmesi: token ve gizli yüzeyler", () => {
  it.each(TOKEN_SURFACES)("%s sayfası robots noindex içerir", (dir) => {
    const src = read(`src/app/${dir}/page.tsx`);
    expect(src).toMatch(/index:\s*false/);
  });

  it("her token yüzeyi robots.txt'te kapalı ve sitemap yasak öneklerinde", () => {
    for (const dir of TOKEN_SURFACES) {
      const prefix = `/${dir.split("/")[0]}`;
      expect(NEVER_INDEX_PREFIXES as readonly string[], prefix).toContain(prefix);
      expect(ALWAYS_DISALLOW as readonly string[], prefix).toContain(`${prefix}/`);
    }
  });

  it("giriş, şifre sıfırlama ve MFA sayfaları noindex", () => {
    for (const p of ["src/app/sifre-sifirla/page.tsx", "src/app/sifre-yenile/page.tsx", "src/app/giris/mfa/page.tsx"]) {
      expect(read(p)).toMatch(/index:\s*false/);
    }
    const giris = seoPages().find((p) => p.path === "/giris");
    expect(giris?.index).toBe(false);
    expect(giris?.canIndex).toBe(false);
    expect(giris?.sitemap.include).toBe(false);
  });

  it("sayfa envanterinde (yönetilebilir statik sayfalar) token/portal/oturumlu yol YOKTUR", () => {
    for (const p of seoPages()) {
      expect(NEVER_INDEX_PREFIXES.some((x) => p.path === x || p.path.startsWith(`${x}/`)) && p.index && p.sitemap.include, p.path).toBe(false);
    }
  });
});

describe("SEO sözleşmesi: sitemap kaynağı", () => {
  const sitemapSources = ["src/lib/seo/sitemap-data.ts", "src/lib/seo/sitemap-rules.ts", "src/app/sitemap.xml/route.ts", "src/app/sitemap/[id]/route.ts"];
  const all = sitemapSources.map(read).join("\n");

  it("eski sitemap.ts kalktı (tek kaynak route + seo kütüphanesi)", () => {
    expect(existsSync(join(root, "src/app/sitemap.ts"))).toBe(false);
  });
  it("ilan sorgusu örnek (demo) kayıtları ve yalnız yayındakileri süzer", () => {
    expect(all).toMatch(/\.eq\("is_sample", false\)/);
    expect(all).toMatch(/\.eq\("status", "live"\)/);
    expect(all).toMatch(/\.is\("deleted_at", null\)/);
  });
  it("sitemap kaynağında token'lı yüzey yolları adres olarak üretilmez", () => {
    for (const dir of TOKEN_SURFACES) {
      const prefix = `/${dir.split("/")[0]}/`;
      // sitemap-rules.ts yasak ÖNEK listesini registry'den alır; adres üretim kodunda bu önekler geçmemeli.
      for (const f of ["src/lib/seo/sitemap-data.ts", "src/app/sitemap.xml/route.ts", "src/app/sitemap/[id]/route.ts"]) {
        expect(read(f), `${f} ${prefix}`).not.toContain(prefix);
      }
    }
  });
  it("tüm girdiler güvenli yol süzgecinden geçer", () => {
    expect(read("src/lib/seo/sitemap-data.ts")).toContain("filterSafeEntries(");
  });
  it("vitrin ofisleri varsayılan olarak yalnız opt-in (güvenli varsayılan)", () => {
    expect(read("src/lib/seo/schema.ts")).toMatch(/onlyOptIn:\s*true/);
  });
  it("AggregateRating/Review üreten kod yok (yalnız yasaklayan doğrulayıcı anar)", () => {
    for (const f of ["src/lib/seo/jsonld.ts", "src/components/seo/seo-json-ld.tsx", "src/components/marketing/landing-jsonld.tsx"]) {
      const src = read(f)
        .split("\n")
        .filter((l) => !/FORBIDDEN_KEYS|yasak|Yasak|ASLA|sahte|Sahte|aggregateRating:|\/\/|\*/.test(l))
        .join("\n");
      expect(src, f).not.toMatch(/"@type":\s*"(AggregateRating|Review)"/);
    }
  });
  it("robot yalnız kendi alan adını tarar (getBaseUrl); harici kaynak adresi sabitlenmemiş", () => {
    const src = read("src/lib/seo/audit-runner.ts");
    expect(src).toContain("getBaseUrl()");
    // Tek dış çağrı IndexNow'dur ve ayara bağlıdır.
    const urls = [...src.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]).filter((u) => !u.includes("example"));
    expect(new Set(urls)).toEqual(new Set(["https://api.indexnow.org"]));
    expect(src).toMatch(/if \(!s\.enabled\)/);
  });
});

describe("SEO sözleşmesi: cron ve yetki", () => {
  const route = read("src/app/api/cron/seo-robot/route.ts");
  it("cron route CRON_SECRET Bearer doğrular ve heartbeat yazar", () => {
    expect(route).toMatch(/authorizeCron|CRON_SECRET/);
    // Bearer doğrulaması ortak kapıdadır (authorizeCron -> cron-auth.ts); route ya kapıyı çağırır ya Bearer'i kendisi doğrular.
    expect(route.includes("authorizeCron(") ? read("src/lib/cron-auth.ts") : route).toMatch(/Bearer \$\{(secret|expected)\}/);
    expect(route).toMatch(/recordHeartbeat\(\s*["']seo-robot["']/);
  });
  it("vercel.json ve cron envanterinde kayıtlı", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const entry = vercel.crons.find((c) => c.path === "/api/cron/seo-robot");
    expect(entry).toBeTruthy();
    expect(CRON_JOBS.find((j) => j.job === "seo-robot")?.schedule).toBe(entry?.schedule);
  });
  it("CRON_SECRET istemciye sızmaz: 'şimdi çalıştır' sunucu action'ı ortak servisi çağırır", () => {
    const actions = read("src/app/actions/seo-admin.ts");
    expect(actions).not.toContain("CRON_SECRET");
    expect(actions).toContain("executeSeoRobot(");
    for (const f of readdirSync(join(root, "src/app/admin/seo")).filter((n) => n.endsWith(".tsx"))) {
      expect(read(`src/app/admin/seo/${f}`), f).not.toContain("CRON_SECRET");
    }
  });
  it("seo modülü yalnız super_admin ve ops'ta; sidebar, palet ve sayfa kapılı", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      expect(mods.includes("seo"), role).toBe(role === "super_admin" || role === "ops");
    }
    // Menü ve komut paleti tek kaynaktan beslenir (src/lib/admin/nav.ts).
    expect(read("src/lib/admin/nav.ts")).toContain('L("/admin/seo", "SEO", "Arama motoru, sitemap, robot", ["seo"])');
    expect(read("src/components/admin/command-palette.tsx")).toContain("adminPaletteFor(modules)");
    expect(read("src/app/admin/seo/page.tsx")).toContain('requirePlatformModule("seo")');
  });
  it("her yazan action seo modülünü doğrular ve duyarlı olanlar süper admine kilitli", () => {
    const actions = read("src/app/actions/seo-admin.ts");
    expect(actions).toContain('requirePlatformModule("seo")');
    for (const fn of ["saveSeoGlobal", "saveSeoSitemap", "saveSeoRobots", "deleteAllSeoRedirects", "setIndexNowEnabled", "regenerateIndexNowKey", "runSeoRobotNow", "importSeoSettings"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 200), fn).toMatch(/guard\(true\)/);
    }
  });
  it("yazma yolları platform etkinlik günlüğüne düşer", () => {
    expect(read("src/app/actions/seo-admin.ts")).toContain("logPlatformActivity(");
  });
});
