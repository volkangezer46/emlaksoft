import { describe, expect, it } from "vitest";
import { createStaticAfterPublishHook } from "./after-publish-hook";
import { speedIssues, type SpeedRouteInput } from "./collector";
import { createStaticRefreshExecutor } from "./executors";
import type { StaticRouteId } from "./registry";

describe("K3 staticAfterPublishHook", () => {
  function hook(opts: { enabled?: StaticRouteId[]; rev?: number | null; warmFails?: string[] } = {}) {
    const log: string[] = [];
    const h = createStaticAfterPublishHook({
      invalidate: (id) => void log.push(`inv:${id}`),
      bumpRev: async () => (log.push("rev"), opts.rev === undefined ? 7 : opts.rev),
      enabledIds: async () => opts.enabled ?? ["home"],
      warm: async (ids) => ids.map((id) => (log.push(`warm:${id}`), { id, ok: !opts.warmFails?.includes(id), isStatic: true })),
    });
    return { h, log };
  }

  it("order 10; eşleşen kimlikler düşer, rev bir kez artar, yalnız açık olanlar ısıtılır", async () => {
    const { h, log } = hook({ enabled: ["home"] });
    expect(h.order).toBe(10);
    const r = await h.run({ surfaceId: "site-menu", livePaths: ["/", "/gizlilik/"] });
    expect(log).toEqual(["inv:home", "inv:gizlilik", "rev", "warm:home"]);
    expect(r.ok).toBe(true);
    expect(r.message).toBe("1 statik sayfa yenilendi");
  });

  it("eşleşme yoksa hiçbir şey yapılmaz", async () => {
    const { h, log } = hook();
    expect((await h.run({ surfaceId: "seo", livePaths: ["/rehber/x"] })).ok).toBe(true);
    expect(log).toEqual([]);
  });

  it("rev yazılamazsa ve ısıtma düşerse dürüst sonuç (fırlatmaz)", async () => {
    const a = await hook({ rev: null }).h.run({ surfaceId: "x", livePaths: ["/"] });
    expect(a.ok).toBe(false);
    expect(a.message).toMatch(/bildirim yazılamadı/);
    const b = await hook({ warmFails: ["home"] }).h.run({ surfaceId: "x", livePaths: ["*"] });
    expect(b.ok).toBe(false);
    expect(b.message).toMatch(/home/);
  });
});

describe("K2 staticRefreshExecutor", () => {
  const exec = (enabled: StaticRouteId[]) => {
    let etag = "a";
    const refreshed: string[] = [];
    return {
      refreshed,
      e: createStaticRefreshExecutor({
        state: async () => ({ etag, at: 1, isStatic: true, gzipBytes: 100 }),
        enabledIds: async () => enabled,
        refresh: async (id) => {
          refreshed.push(id);
          etag = "b";
          return { ok: true };
        },
      }),
    };
  };

  it("kind static_refresh, risk güvenli; plan kuru çalışmadır", async () => {
    const { e, refreshed } = exec(["home"]);
    expect(e.kind).toBe("static_refresh");
    expect(e.risk).toBe("guvenli");
    const p = await e.plan({ url: "https://emlaksoft.com.tr/" });
    expect(p.canApply).toBe(true);
    expect(refreshed).toEqual([]);
  });

  it("apply önce/sonra döner; kapalı ya da kayıtsız yol uygulanmaz", async () => {
    const { e, refreshed } = exec(["home"]);
    const r = await e.apply({ url: "/" });
    expect(r).toMatchObject({ ok: true, before: { etag: "a" }, after: { etag: "b" } });
    expect((await e.apply({ url: "/gizlilik" })).ok).toBe(false);
    expect((await e.apply({ url: "/kayit" })).ok).toBe(false);
    expect(refreshed).toEqual(["home"]);
  });
});

describe("K1 speedCollector (saf çekirdek)", () => {
  const route = (over: Partial<SpeedRouteInput>): SpeedRouteInput => ({
    id: "home",
    path: "/",
    label: "Ana sayfa",
    mode: "on",
    lastRenderAt: 1,
    lastStatic: true,
    rawBytes: 300 * 1024,
    gzipBytes: 70 * 1024,
    lastFallbackReason: null,
    ...over,
  });

  it("bütçe aşımı, yedeğe düşme, PSI düşüşü ve br yok bulguları; her biri Türkçe açıklamalı", () => {
    const { issues, scanned } = speedIssues({
      routes: [
        route({ gzipBytes: 90 * 1024 }),
        route({ id: "gizlilik", path: "/gizlilik", label: "Gizlilik", lastStatic: false, lastFallbackReason: "biçim" }),
        route({ id: "kvkk-aydinlatma", path: "/kvkk-aydinlatma", lastRenderAt: null }),
      ],
      labRuns: [
        { day: "2026-10-13", path: "/", device: "mobile", source: "psi", score: 80 },
        { day: "2026-10-12", path: "/", device: "mobile", source: "psi", score: 92 },
        { day: "2026-10-13", path: "/", device: "desktop", source: "psi", score: 95 },
        { day: "2026-10-12", path: "/", device: "desktop", source: "psi", score: 99 },
      ],
      compression: { encoding: "gzip", label: "gzip", tone: "warn", status: 200 },
    });
    const codes = issues.map((i) => `${i.url}|${i.code}|${i.severity}`).sort();
    expect(codes).toEqual(["/gizlilik|static_fallback|uyari", "/|compression_no_br|bilgi", "/|psi_drop_mobile|uyari", "/|static_html_budget|uyari"]);
    for (const i of issues) {
      expect(i.area).toBe("hiz");
      expect(i.explain.length).toBeGreaterThan(20);
      expect(i.explain.length).toBeLessThanOrEqual(240);
      expect(i.title.length).toBeLessThanOrEqual(160);
      expect(i.code.length).toBeLessThanOrEqual(64);
    }
    expect(issues.find((i) => i.code === "static_fallback")?.proposal).toEqual({ kind: "static_refresh", target: { url: "/gizlilik" } });
    // Bellek durumu olmayan yol taranmış sayılmaz.
    expect(scanned.sort()).toEqual(["/", "/gizlilik"]);
  });

  it("veri yoksa bulgu yok ve taranan yol yok", () => {
    expect(speedIssues({ routes: [route({ lastRenderAt: null })], labRuns: [], compression: null })).toEqual({ issues: [], scanned: [] });
  });

  it("br açıksa ve düşüş ≤5 ise bulgu yok", () => {
    const { issues } = speedIssues({
      routes: [route({})],
      labRuns: [
        { day: "2026-10-13", path: "/", device: "mobile", source: "psi", score: 87 },
        { day: "2026-10-12", path: "/", device: "mobile", source: "psi", score: 92 },
      ],
      compression: { encoding: "br", label: "br", tone: "ok", status: 200 },
    });
    expect(issues).toEqual([]);
  });
});
