import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/site-issues/store", () => ({ readActions: async () => ({ available: true, data: [] }), recordOptimizerAction: async () => true }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: async () => undefined }));

import type { AfterPublishEvent, AfterPublishHook } from "@/lib/site-issues/types";
import { hashOf } from "@/lib/publishing/schedule";
import { DRAFT_CHANGED, NOT_PREVIEWED, publishDraftsSequential } from "@/lib/site-issues/publish-all";
import { bodyDigest, captureLiveDigests, createBaselineRecorder, createVerifyHook, runAfterPublish } from "./after-publish";

const ev: AfterPublishEvent = { surface: "sitecontent", kind: "publish", publishRef: "r1", livePaths: ["/", "/kayit"], actorId: "u1", source: "staff" };
const hook = (id: string, order: number, run: AfterPublishHook["run"]): AfterPublishHook => ({ id, order, run });

describe("runAfterPublish (yayın sonrası zinciri)", () => {
  it("kancalar `order` sırasıyla çalışır; biri fırlatınca sonrakiler sürer; zincir asla fırlatmaz", async () => {
    const calls: string[] = [];
    const record = vi.fn(async () => true);
    const log = vi.fn(async () => undefined);
    const r = await runAfterPublish(ev, {
      hooks: [
        hook("c", 30, async () => (calls.push("c"), { ok: true, message: "c" })),
        hook("a", 10, async () => {
          calls.push("a");
          throw new Error("patladı");
        }),
        hook("b", 20, async () => (calls.push("b"), { ok: true, message: "b" })),
      ],
      record,
      log,
    });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(r.ok).toBe(false);
    expect(r.hooks.map((h) => [h.id, h.ok])).toEqual([["a", false], ["b", true], ["c", true]]);
    expect(r.hooks[0]!.message).toContain("patladı");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: "after_publish", target: "sitecontent", status: "kismi", publishRef: "r1" }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: "publishing.after_publish" }));
  });

  it("zaman aşımı kancayı yalıtır; kayıt/denetim yazımı fırlatsa bile sonuç döner", async () => {
    const r = await runAfterPublish(ev, {
      hooks: [hook("yavas", 10, () => new Promise(() => {})), hook("sonra", 20, async () => ({ ok: true, message: "tamam" }))],
      timeoutMs: 20,
      record: async () => {
        throw new Error("db yok");
      },
      log: async () => {
        throw new Error("log yok");
      },
    });
    expect(r.hooks.map((h) => [h.id, h.ok])).toEqual([["yavas", false], ["sonra", true]]);
    expect(r.hooks[0]!.message).toContain("zaman aşımı");
  });
});

describe("verify kancası", () => {
  const page = (body: string, status = 200) => async () => ({ status, body });
  const at = Date.UTC(2026, 9, 13, 11, 4, 5);
  const was = (html: string) => ({ "/": bodyDigest(html) });

  it("HTTP 200 ve özet yayın öncesi tabandan farklı: 'Canlıda doğrulandı hh:mm:ss' (TR saati)", async () => {
    const h = createVerifyHook({ fetchPage: page("<h1>yeni</h1>"), nowMs: () => at });
    const r = await h.run({ ...ev, livePaths: ["/"], beforeDigests: was("<h1>eski</h1>") });
    expect(r).toMatchObject({ ok: true, message: "Canlıda doğrulandı 14:04:05" });
    expect(h.order).toBe(20);
  });

  it("özet aynı ya da HTTP 200 değil: 'Henüz yansımadı — tekrar dene'", async () => {
    const same = createVerifyHook({ fetchPage: page("<h1>eski</h1>"), nowMs: () => at });
    expect((await same.run({ ...ev, livePaths: ["/"], beforeDigests: was("<h1>eski</h1>") })).message).toBe("Henüz yansımadı — tekrar dene");
    const down = createVerifyHook({ fetchPage: page("", 500), nowMs: () => at });
    expect((await down.run({ ...ev, livePaths: ["/"] })).ok).toBe(false);
  });

  it("taban yoksa 'doğrulandı' DENMEZ: yalnız HTTP 200 olduğu dürüstçe söylenir", async () => {
    const h = createVerifyHook({ fetchPage: page("<h1>yeni</h1>"), nowMs: () => at });
    const r = await h.run({ ...ev, livePaths: ["/"] });
    expect(r).toMatchObject({ ok: true, message: "HTTP 200 (karşılaştırma tabanı yok) 14:04:05" });
    expect(r.message).not.toContain("doğrulandı");
  });

  it("başka yüzeyin aynı yolu değiştirmesi sahte doğrulama üretmez: taban bu yayının HEMEN öncesidir", async () => {
    // sitecontent "/" yolunu "<h1>A</h1>"dan "<h1>B</h1>"ye çevirdi; ardından sitemenu yayını canlıya yansımadı.
    // Taban yayın anında alındığı için ("<h1>B</h1>") eski doğrulama kaydı ("<h1>A</h1>") karşılaştırmaya girmez.
    const h = createVerifyHook({ fetchPage: page("<h1>B</h1>"), nowMs: () => at });
    const r = await h.run({ ...ev, surface: "sitemenu", livePaths: ["/"], beforeDigests: was("<h1>B</h1>") });
    expect(r).toMatchObject({ ok: false, message: "Henüz yansımadı — tekrar dene" });
  });

  it("yayından kaldırma: yol 404 dönünce 'Canlıdan kaldırıldı', 200 dönerse yansımadı", async () => {
    const gone = createVerifyHook({ fetchPage: page("", 404), nowMs: () => at });
    expect(await gone.run({ ...ev, kind: "unpublish", livePaths: ["/x"] })).toMatchObject({ ok: true, message: "Canlıdan kaldırıldı 14:04:05" });
    const still = createVerifyHook({ fetchPage: page("<h1>x</h1>"), nowMs: () => at });
    expect((await still.run({ ...ev, kind: "unpublish", livePaths: ["/x"] })).ok).toBe(false);
  });

  it("captureLiveDigests: yalnız 200 dönen yollar tabana girer; hata ASLA fırlatılmaz", async () => {
    const fetchPage = async (path: string) => {
      if (path === "/patlar") throw new Error("ağ");
      if (path === "/yok") return { status: 404, body: "" };
      if (path === "/bos") return null;
      return { status: 200, body: `<h1>${path}</h1>` };
    };
    expect(await captureLiveDigests(["/", "/patlar", "/yok", "/bos", "/"], fetchPage)).toEqual({ "/": bodyDigest("<h1>/</h1>") });
  });

  it("gövde özeti istekten isteğe değişen nonce ve betikleri yok sayar", () => {
    expect(bodyDigest('<p nonce="aaa">x</p><script>self.__next_f=1</script>')).toBe(bodyDigest('<p nonce="bbb">x</p><script>self.__next_f=2</script>'));
    expect(bodyDigest("<p>x</p>")).not.toBe(bodyDigest("<p>y</p>"));
  });
});

type FakeSurface = Parameters<typeof publishDraftsSequential>[0][number];

function fakeSurface(id: string, opts: { draft?: unknown; live?: unknown; fail?: string; throws?: boolean } = {}) {
  const published: unknown[] = [];
  const s: FakeSurface = {
    id: id as FakeSurface["id"],
    label: `Yüzey ${id}`,
    livePaths: [{ path: `/${id}` }],
    defaults: () => ({ v: 0 }),
    readState: async () => {
      if (opts.throws) throw new Error("okunamadı");
      return { live: opts.live ?? null, draft: opts.draft ?? null, history: [], updatedBy: null, updatedAt: null };
    },
    publish: async (cfg) => {
      published.push(cfg);
      return opts.fail ? { ok: false, error: opts.fail } : { ok: true };
    },
  };
  return { s, published };
}

describe("publishAllDrafts çekirdeği (sahte yüzeyle)", () => {
  it("bekleyen taslakları sırayla yayınlar; biri hata verince diğerleri sürer; taslağı olmayan atlanır", async () => {
    const a = fakeSurface("a", { draft: { v: 1 } });
    const b = fakeSurface("b", { draft: { v: 2 }, fail: "kural hatası" });
    const c = fakeSurface("c", { draft: { v: 0 } }); // varsayılanla aynı: bekleyen yok
    const d = fakeSurface("d", { throws: true });
    const e = fakeSurface("e", { draft: { v: 5 }, live: { v: 4 } });
    const events: AfterPublishEvent[] = [];
    const items = await publishDraftsSequential([a.s, b.s, c.s, d.s, e.s], { id: "u1", name: "Ayşe", source: "staff" }, { onPublished: (x) => void events.push(x) });
    expect(items.map((i) => [i.surface, i.ok, Boolean(i.skipped)])).toEqual([
      ["a", true, false],
      ["b", false, false],
      ["c", true, true],
      ["d", false, false],
      ["e", true, false],
    ]);
    expect(items[1]!.message).toBe("kural hatası");
    expect(a.published).toEqual([{ v: 1 }]);
    expect(c.published).toEqual([]);
    // Yayın sonrası zinciri yalnız başarılı yayınlarda, yüzeyin canlı yollarıyla.
    expect(events.map((x) => [x.surface, x.livePaths])).toEqual([["a", ["/a"]], ["e", ["/e"]]]);
  });

  it("yayın sonrası zincirinin hatası yayın sonucunu değiştirmez (ok kalır)", async () => {
    const a = fakeSurface("a", { draft: { v: 1 } });
    const items = await publishDraftsSequential([a.s], { id: "u1", name: "Ayşe", source: "staff" }, {
      onPublished: () => {
        throw new Error("kanca patladı");
      },
    });
    expect(items).toEqual([{ surface: "a", label: "Yüzey a", ok: true, message: "Yayınlandı." }]);
  });

  it("önizleme özeti: yalnız önizlenen ve özeti hâlâ aynı taslak yayınlanır", async () => {
    const a = fakeSurface("a", { draft: { v: 1 } });
    const b = fakeSurface("b", { draft: { v: 2 } }); // önizlemeden sonra değişti
    const c = fakeSurface("c", { draft: { v: 3 } }); // önizlemede yoktu
    const items = await publishDraftsSequential([a.s, b.s, c.s], { id: "u1", name: "Ayşe", source: "staff" }, {
      expected: { a: hashOf({ v: 1 }), b: hashOf({ v: 99 }) },
    });
    expect(items.map((i) => [i.surface, i.ok, Boolean(i.skipped), i.message])).toEqual([
      ["a", true, false, "Yayınlandı."],
      ["b", false, true, DRAFT_CHANGED],
      ["c", false, true, NOT_PREVIEWED],
    ]);
    expect(a.published).toEqual([{ v: 1 }]);
    expect(b.published).toEqual([]);
    expect(c.published).toEqual([]);
  });

  it("yayın öncesi taban yazımdan ÖNCE alınır ve olaya beforeDigests olarak geçer", async () => {
    const order: string[] = [];
    const a = fakeSurface("a", { draft: { v: 1 } });
    const publish = a.s.publish;
    a.s.publish = async (...args) => (order.push("publish"), publish(...args));
    const events: AfterPublishEvent[] = [];
    await publishDraftsSequential([a.s], { id: "u1", name: "Ayşe", source: "staff" }, {
      captureBefore: async (paths) => (order.push("capture"), { [paths[0]!]: "eski" }),
      onPublished: (x) => void events.push(x),
    });
    expect(order).toEqual(["capture", "publish"]);
    expect(events[0]!.beforeDigests).toEqual({ "/a": "eski" });
  });
});

describe("sözleşme: afterPublish her yayın yolunda çağrılır", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const body = (src: string, fn: string) => {
    const i = src.indexOf(`export async function ${fn}`);
    expect(i, fn).toBeGreaterThan(-1);
    const j = src.indexOf("\nexport ", i + 10);
    return src.slice(i, j === -1 ? undefined : j);
  };
  const CHAIN = 'afterSafe(() => runAfterPublish(';
  const BULK_CHAIN = 'onPublished: (ev) => afterSafe(() => runAfterPublish(ev), "yayın sonrası zinciri")';
  const exportsOf = (src: string) => [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]!);
  // Canlıyı değiştiren HER export (`refreshLive(` çağıran) zinciri başlatır: elle seçilmiş liste değil, dosyanın tamamı.
  const files = ["src/app/actions/publishing.ts", "src/app/actions/site-content.ts", "src/app/actions/site-menu.ts", "src/app/actions/site-pages.ts", "src/app/actions/pricing-page.ts"];

  it.each(files)("%s: refreshLive çağıran her export başarıdan sonra afterSafe(() => runAfterPublish(...)) çağırır", (file) => {
    const src = read(file);
    expect(src).not.toContain('from "next/server"');
    expect(src).toContain('from "@/lib/after-safe"');
    const live = exportsOf(src).filter((fn) => body(src, fn).includes("refreshLive("));
    expect(live.length, file).toBeGreaterThan(0);
    for (const fn of live) {
      const b = body(src, fn);
      if (b.includes("onPublished:")) {
        // Toplu çekirdek kancayı yalnız başarılı yayından sonra çağırır (yukarıdaki sahte yüzey testi) ve tabanı kendisi alır.
        expect(b, fn).toContain(BULK_CHAIN);
        expect(b, fn).toContain("captureBefore:");
        continue;
      }
      // Doğrudan yollarda zincir canlı tazelemeden (yani başarı kontrolünden) SONRA gelir.
      expect(b, fn).toContain(CHAIN);
      expect(b.indexOf(CHAIN), fn).toBeGreaterThan(b.indexOf("refreshLive("));
      // Yayından kaldırma dışındaki yollar yayın öncesi tabanı yazımdan ÖNCE alır.
      if (!b.includes('kind: "unpublish"')) {
        expect(b, fn).toMatch(/const beforeDigests = await captureLiveDigests\(/);
        expect(b.indexOf("captureLiveDigests("), fn).toBeLessThan(b.search(/if \(!res\.ok\)/));
        expect(b, fn).toContain("beforeDigests");
      }
    }
  });

  it("varsayılana dönüş ve yayından kaldırma da zinciri çalıştırır (kind reset / unpublish)", () => {
    for (const [file, fn, kind] of [
      ["src/app/actions/site-content.ts", "resetSiteContentToDefault", "reset"],
      ["src/app/actions/site-menu.ts", "resetSiteMenuToDefault", "reset"],
      ["src/app/actions/pricing-page.ts", "resetPricingPageToDefault", "reset"],
      ["src/app/actions/site-pages.ts", "unpublishSitePage", "unpublish"],
    ] as const) {
      expect(body(read(file), fn), fn).toContain(`kind: "${kind}"`);
    }
  });

  it("Kokpit toplu yayını ve Otopilot: önizleme özeti + taban + afterSafe", () => {
    const opt = read("src/app/actions/optimizer.ts");
    expect(opt).not.toContain('from "next/server"');
    const b = body(opt, "publishAllDrafts");
    expect(b).toContain(BULK_CHAIN);
    expect(b).toContain("captureBefore:");
    expect(b).toMatch(/expected,/);
    expect(b).toContain("publishAllSchema.safeParse(input)");
    const auto = read("src/lib/site-issues/autopilot-server.ts");
    expect(auto).not.toContain('from "next/server"');
    expect(auto).toContain(BULK_CHAIN);
  });

  it("yayın zamanlayıcı cron'u zinciri await + süre sınırıyla çağırır", () => {
    const src = read("src/app/api/cron/yayin-zamanlayici/route.ts");
    expect(src).toMatch(/await Promise\.race\(\[[\s\S]*runAfterPublish\(/);
    expect(src).toContain("AFTER_PUBLISH_BUDGET_MS");
  });

  it("yayın zamanlayıcı yazımdan ÖNCE taban alır ve zincire beforeDigests olarak geçer", () => {
    const src = read("src/app/api/cron/yayin-zamanlayici/route.ts");
    expect(src).toMatch(/await captureBaseline\(s\);\s*return s\.publish\(/);
    expect(src).toMatch(/await captureBaseline\(s\);\s*return s\.resetToDefault\(/);
    expect(src).toContain("beforeDigests: baselines.get(s.id)");
  });
});

describe("zamanlı yayın tabanı (createBaselineRecorder)", () => {
  it("cron yolu: taban yazımdan önce alınır → verify gerçek önce/sonra karşılaştırması yapar", async () => {
    let live = "<h1>eski</h1>";
    const fetchPage = async () => ({ status: 200, body: live });
    const rec = createBaselineRecorder({ capture: (paths) => captureLiveDigests(paths, fetchPage) });
    await rec.before("sitecontent", ["/"]);
    live = "<h1>yeni</h1>"; // zamanlı yayın yazıldı
    const at = Date.UTC(2026, 9, 13, 11, 4, 5);
    const verify = createVerifyHook({ fetchPage, nowMs: () => at });
    const okRun = await verify.run({ ...ev, livePaths: ["/"], source: "cron", beforeDigests: rec.get("sitecontent") });
    expect(okRun.ok).toBe(true);
    expect(okRun.message).toMatch(/^Canlıda doğrulandı /);
    // Yansımadıysa (canlı aynı) dürüstçe söylenir; artık "karşılaştırma tabanı yok" denmez.
    const rec2 = createBaselineRecorder({ capture: (paths) => captureLiveDigests(paths, fetchPage) });
    await rec2.before("sitecontent", ["/"]);
    const stale = await verify.run({ ...ev, livePaths: ["/"], source: "cron", beforeDigests: rec2.get("sitecontent") });
    expect(stale).toMatchObject({ ok: false, message: "Henüz yansımadı — tekrar dene" });
  });

  it("yüzey başına koşuda bir kez (ilk yazımdan önceki hâl) alınır", async () => {
    const capture = vi.fn(async () => ({ "/": "a" }));
    const rec = createBaselineRecorder({ capture });
    await rec.before("s1", ["/"]);
    await rec.before("s1", ["/"]);
    await rec.before("s2", ["/x"]);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(rec.get("s1")).toEqual({ "/": "a" });
  });

  it("taban alınamazsa (fırlatma / asılı kalma) yayın engellenmez: kesin üst sınırda boş tabanla döner", async () => {
    const rec = createBaselineRecorder({
      capture: async () => {
        throw new Error("ağ");
      },
    });
    await expect(rec.before("s1", ["/"])).resolves.toBeUndefined();
    expect(rec.get("s1")).toEqual({});
    const hang = createBaselineRecorder({ capture: () => new Promise(() => {}), hardCapMs: 20 });
    await hang.before("s2", ["/"]);
    expect(hang.get("s2")).toEqual({});
  });

  it("koşu bütçesi bitince taban denenmez (undefined → doğrulama tabansız der)", async () => {
    let t = 0;
    const capture = vi.fn(async () => {
      t += 50;
      return { "/": "a" };
    });
    const rec = createBaselineRecorder({ capture, budgetMs: 60, nowMs: () => t });
    await rec.before("s1", ["/"]);
    await rec.before("s2", ["/"]);
    await rec.before("s3", ["/"]);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(rec.get("s3")).toBeUndefined();
    await rec.before("bos", []);
    expect(rec.get("bos")).toBeUndefined();
  });
});
