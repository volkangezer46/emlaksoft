import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTOPILOT, runAutopilot, type AutopilotDeps } from "./autopilot";
import { runNightlyKokpit } from "./nightly";

/**
 * Gece Kokpit adımı: yalıtılmış alt adımlar ve Otopilot KAPALIYKEN SIFIR yazma. Yeni cron rotası eklenmez (seo-robot).
 */

function autopilotDeps(enabled: boolean) {
  const deps = {
    readSettings: async () => ({ ...DEFAULT_AUTOPILOT, enabled }),
    listIssues: vi.fn(async () => []),
    executors: [],
    record: vi.fn(async () => true),
    patchIssue: vi.fn(async () => true),
    publishSurfaces: vi.fn(async () => []),
  } satisfies AutopilotDeps;
  return deps;
}

describe("gece Kokpit adımı", () => {
  it("Otopilot varsayılan KAPALI: hiçbir kayıt/durum/yayın yazılmaz, kuyruk bile okunmaz", async () => {
    const ap = autopilotDeps(false);
    const out = await runNightlyKokpit({ sync: async () => [], autopilot: () => runAutopilot(ap), prune: async () => 0 });
    expect(out.note).toContain("Otopilot kapalı");
    expect(out.failed).toBe(0);
    expect(ap.record).not.toHaveBeenCalled();
    expect(ap.patchIssue).not.toHaveBeenCalled();
    expect(ap.publishSurfaces).not.toHaveBeenCalled();
    expect(ap.listIssues).not.toHaveBeenCalled();
    expect(DEFAULT_AUTOPILOT.enabled).toBe(false);
  });

  it("alt adımlar yalıtılmış: kuyruk hatası Otopilot ve budamayı durdurmaz; hata sayılır ve nota yazılır", async () => {
    const prune = vi.fn(async () => 3);
    const ap = autopilotDeps(true);
    const out = await runNightlyKokpit({
      sync: async () => {
        throw new Error("tablo yok");
      },
      autopilot: () => runAutopilot(ap),
      prune,
    });
    expect(prune).toHaveBeenCalledTimes(1);
    expect(ap.record).toHaveBeenCalled(); // açıkken koşu kaydı yazılır
    expect(out.failed).toBe(1);
    expect(out.note).toMatch(/kuyruk hata: tablo yok/);
    expect(out.note).toMatch(/3 eski kayıt budandı/);
  });

  it("toplayıcı sonuçları özetlenir; başarısız toplayıcı hata sayılır", async () => {
    const out = await runNightlyKokpit({
      sync: async () => [
        { collector: "a", label: "A", area: "seo", ok: true, message: "", ms: 1, counts: { yeni: 2, gorulen: 0, dogrulandi: 1, yenidenAcildi: 0 } },
        { collector: "b", label: "B", area: "hiz", ok: false, message: "x", ms: 1 },
      ],
      autopilot: async () => ({ ran: false, considered: 0, prepared: 0, failed: 0, published: [] }),
      prune: async () => {
        throw new Error("rpc yok");
      },
    });
    expect(out.note).toContain("kuyruk 1/2 toplayıcı, 2 yeni, 1 düzelmiş");
    expect(out.failed).toBe(2);
  });

  it("mevcut seo-robot cron'una bağlı (yeni cron rotası yok; robot hatasından bağımsız try/catch)", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/cron/seo-robot/route.ts"), "utf8");
    expect(route).toContain("runNightlyKokpitNow()");
    expect(route).toMatch(/try \{\s*kokpit = await runNightlyKokpitNow\(\);\s*\} catch/);
    expect(route).toContain("kokpit.note");
    const crons = (JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: unknown[] }).crons;
    expect(crons.length).toBe(40);
  });
});
