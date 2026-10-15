import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REALTIME_ECHO_WINDOW_MS, shouldIgnoreEcho, type LocalMutation } from "./realtime-throttle";

/**
 * B004: yankı süzgeci SEKME bazlıdır. Olay yalnız bu sekme son 3 sn içinde yazdıysa (ve olayı aynı kullanıcı yazdıysa)
 * yok sayılır. Aynı kullanıcının ikinci cihazı/sekmesi (iki bağlam da odakta) kendi eklediği kaydı görür.
 */
const at = (t: number, tables: LocalMutation["tables"] = "*"): LocalMutation => ({ at: t, tables });

describe("shouldIgnoreEcho", () => {
  it("bu sekme az önce yazdı ve olayı aynı kullanıcı yazdı: yok sayılır", () => {
    expect(shouldIgnoreEcho({ t: "tasks", by: "u1" }, "u1", at(1_000), 1_500)).toBe(true);
    expect(shouldIgnoreEcho({ t: "tasks", by: "u1" }, "u1", at(1_000, new Set(["tasks"])), 1_500)).toBe(true);
  });

  it("ikinci cihaz/sekme (bu sekmede yerel yazım yok): aynı kullanıcının kaydı GÖRÜNÜR", () => {
    expect(shouldIgnoreEcho({ t: "tasks", by: "u1" }, "u1", null, 1_500)).toBe(false);
  });

  it("pencere 3 sn: daha eski yazım yankı sayılmaz", () => {
    expect(shouldIgnoreEcho({ t: "tasks", by: "u1" }, "u1", at(1_000), 1_000 + REALTIME_ECHO_WINDOW_MS)).toBe(true);
    expect(shouldIgnoreEcho({ t: "tasks", by: "u1" }, "u1", at(1_000), 1_001 + REALTIME_ECHO_WINDOW_MS)).toBe(false);
  });

  it("başka kullanıcının yazımı ya da aktörsüz (cron/servis) olay asla yok sayılmaz", () => {
    expect(shouldIgnoreEcho({ t: "tasks", by: "u2" }, "u1", at(1_000), 1_100)).toBe(false);
    expect(shouldIgnoreEcho({ t: "tasks", by: null }, "u1", at(1_000), 1_100)).toBe(false);
    expect(shouldIgnoreEcho({ t: "tasks", by: "u1" }, null, at(1_000), 1_100)).toBe(false);
  });

  it("tablo biliniyorsa başka tabloya yazım yankı sayılmaz", () => {
    expect(shouldIgnoreEcho({ t: "deals", by: "u1" }, "u1", at(1_000, new Set(["tasks"])), 1_100)).toBe(false);
  });

  it("istemci saati geride/ileride: gelecekteki yerel kayıt yankı saymaz (saat sıçraması)", () => {
    expect(shouldIgnoreEcho({ t: "tasks", by: "u1" }, "u1", at(5_000), 1_000)).toBe(false);
  });

  it("odak ve created_by kuralları kaldırıldı", () => {
    const hook = readFileSync(resolve(process.cwd(), "src/hooks/use-realtime-refresh.ts"), "utf8");
    expect(hook).not.toMatch(/hasFocus/);
    expect(hook).not.toMatch(/created_by/);
    expect(hook).toMatch(/shouldIgnoreEcho\(evt, selfUserId, getLocalMutation\(\), now\(\)\)/);
  });
});

describe("server action izleyicisi (sekme içi son yazım)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("next-action başlıklı POST yerel yazım kaydeder; diğer istekler kaydetmez; istek aynen iletilir", async () => {
    const calls: unknown[] = [];
    const original = vi.fn(async (...args: unknown[]) => {
      calls.push(args);
      return new Response(null, { status: 204 });
    });
    const win = { fetch: original } as unknown as Window & typeof globalThis;
    vi.stubGlobal("window", win);
    const rt = await import("./realtime");
    expect(rt.getLocalMutation()).toBeNull();
    rt.installServerActionTracker();
    rt.installServerActionTracker(); // tek kez kurulur
    await win.fetch("/app/gorevler", { method: "GET" });
    expect(rt.getLocalMutation()).toBeNull();
    await win.fetch("/app/gorevler", { method: "POST", headers: { Accept: "text/x-component", "next-action": "abc" } });
    expect(rt.getLocalMutation()?.tables).toBe("*");
    expect(calls).toHaveLength(2);
    expect(original).toHaveBeenCalledTimes(2);
  });

  it("açık tablo bilgisi birleşir; pencere içinde '*' kalır", async () => {
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    const rt = await import("./realtime");
    rt.noteLocalMutation(["tasks"]);
    rt.noteLocalMutation(["customers"]);
    const m = rt.getLocalMutation();
    expect(m && m.tables !== "*" ? [...m.tables].sort() : m?.tables).toEqual(["customers", "tasks"]);
    rt.noteLocalMutation();
    rt.noteLocalMutation(["deals"]);
    expect(rt.getLocalMutation()?.tables).toBe("*");
  });
});
