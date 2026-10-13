import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/site-issues/store", () => ({ readActions: async () => ({ available: true, data: [] }), recordOptimizerAction: async () => true }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: async () => undefined }));

import type { AfterPublishEvent, AfterPublishHook } from "@/lib/site-issues/types";
import { publishDraftsSequential } from "@/lib/site-issues/publish-all";
import { bodyDigest, createVerifyHook, runAfterPublish } from "./after-publish";

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

  it("HTTP 200 ve özet yayın öncesinden farklı: 'Canlıda doğrulandı hh:mm:ss' (TR saati)", async () => {
    const h = createVerifyHook({ fetchPage: page("<h1>yeni</h1>"), previousDigests: async () => ({ "/": bodyDigest("<h1>eski</h1>") }), nowMs: () => at });
    const r = await h.run({ ...ev, livePaths: ["/"] });
    expect(r).toMatchObject({ ok: true, message: "Canlıda doğrulandı 14:04:05" });
    expect(h.order).toBe(20);
  });

  it("özet aynı ya da HTTP 200 değil: 'Henüz yansımadı — tekrar dene'", async () => {
    const same = createVerifyHook({ fetchPage: page("<h1>eski</h1>"), previousDigests: async () => ({ "/": bodyDigest("<h1>eski</h1>") }), nowMs: () => at });
    expect((await same.run({ ...ev, livePaths: ["/"] })).message).toBe("Henüz yansımadı — tekrar dene");
    const down = createVerifyHook({ fetchPage: page("", 500), previousDigests: async () => ({}), nowMs: () => at });
    expect((await down.run({ ...ev, livePaths: ["/"] })).ok).toBe(false);
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
});

describe("sözleşme: afterPublish her yayın yolunda çağrılır", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const body = (src: string, fn: string) => {
    const i = src.indexOf(`export async function ${fn}`);
    expect(i, fn).toBeGreaterThan(-1);
    const j = src.indexOf("\nexport ", i + 10);
    return src.slice(i, j === -1 ? undefined : j);
  };
  const paths: [string, string[]][] = [
    ["src/app/actions/publishing.ts", ["restoreVersion", "publishDraftNow"]],
    ["src/app/actions/optimizer.ts", ["publishAllDrafts"]],
    ["src/app/actions/site-content.ts", ["publishSiteContent", "rollbackSiteContent"]],
    ["src/app/actions/site-menu.ts", ["publishSiteMenu", "rollbackSiteMenu"]],
    ["src/app/actions/site-pages.ts", ["publishSitePage", "rollbackSitePage"]],
    ["src/app/actions/pricing-page.ts", ["publishPricingPage", "rollbackPricingPage"]],
  ];
  it.each(paths)("%s: başarılı yayından sonra after(() => runAfterPublish(...))", (file, fns) => {
    const src = read(file);
    expect(src).toContain('import { after } from "next/server"');
    for (const fn of fns) {
      const b = body(src, fn);
      expect(b, fn).toMatch(/after\(\(\) => runAfterPublish\(/);
      // Toplu çekirdek kancayı yalnız başarılı yayından sonra çağırır (yukarıdaki sahte yüzey testi); doğrudan yollarda
      // çağrı başarı kontrolünden SONRA gelir.
      if (b.includes("onPublished:")) expect(b, fn).toContain("onPublished: (ev) => after(() => runAfterPublish(ev))");
      else expect(b.indexOf("runAfterPublish"), fn).toBeGreaterThan(b.search(/if \(!res\.ok\)/));
    }
  });

  it("yayın zamanlayıcı cron'u zinciri await + süre sınırıyla çağırır", () => {
    const src = read("src/app/api/cron/yayin-zamanlayici/route.ts");
    expect(src).toMatch(/await Promise\.race\(\[[\s\S]*runAfterPublish\(/);
    expect(src).toContain("AFTER_PUBLISH_BUDGET_MS");
  });
});
