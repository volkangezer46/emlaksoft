import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_DEFAULT_TIMEOUT_MS, IDLE_FALLBACK_DELAY_MS, runWhenIdle } from "@/lib/idle";
import { walkSource } from "@/lib/test-support/src-tree";

/**
 * runWhenIdle SÖZLEŞMESİ: varsayılan üst sınır 4000 ms kalır (ertelenebilir panel/ön yükleme işleri ilk etkileşimle
 * yarışmasın). Realtime aboneliği daha kısa sınırı AÇIK parametreyle ister (SK2 B013: SSR ile ilk katılım arasındaki
 * açılış penceresi kısa kalmalı); varsayılanı düşürmek tüm ertelenen işleri öne çeker, bu yüzden yasak.
 */
type IdleWin = { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

function withWindow(win: IdleWin & Partial<Pick<Window, "setTimeout" | "clearTimeout">>) {
  vi.stubGlobal("window", win);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runWhenIdle varsayılanı", () => {
  it("varsayılan üst sınır 4000 ms", () => {
    expect(IDLE_DEFAULT_TIMEOUT_MS).toBe(4_000);
    const calls: Array<{ timeout: number } | undefined> = [];
    withWindow({ requestIdleCallback: (_fn, o) => (calls.push(o), 1), cancelIdleCallback: () => {} });
    runWhenIdle(() => {});
    expect(calls).toEqual([{ timeout: 4_000 }]);
  });

  it("açık timeoutMs yalnız o çağrıyı etkiler", () => {
    const calls: Array<{ timeout: number } | undefined> = [];
    withWindow({ requestIdleCallback: (_fn, o) => (calls.push(o), 1), cancelIdleCallback: () => {} });
    runWhenIdle(() => {}, { timeoutMs: 800 });
    runWhenIdle(() => {});
    expect(calls).toEqual([{ timeout: 800 }, { timeout: 4_000 }]);
  });

  it("requestIdleCallback yoksa setTimeout: varsayılan 1500 ms, açık sınır daha kısaysa o", () => {
    const delays: number[] = [];
    withWindow({
      setTimeout: ((_fn: () => void, ms?: number) => (delays.push(ms ?? 0), 1)) as unknown as Window["setTimeout"],
      clearTimeout: (() => {}) as Window["clearTimeout"],
    });
    runWhenIdle(() => {});
    runWhenIdle(() => {}, { timeoutMs: 800 });
    expect(delays).toEqual([IDLE_FALLBACK_DELAY_MS, 800]);
  });

  it("iptal fonksiyonu bekleyen işi iptal eder", () => {
    const cancelled: number[] = [];
    withWindow({ requestIdleCallback: () => 42, cancelIdleCallback: (id) => cancelled.push(id) });
    runWhenIdle(() => {})();
    expect(cancelled).toEqual([42]);
  });
});

describe("çağıranlar", () => {
  const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("idle.ts varsayılanı sabitten okur; sabit 4000 dışına çekilmez", () => {
    const idle = src("src/lib/idle.ts");
    expect(idle).toMatch(/export const IDLE_DEFAULT_TIMEOUT_MS = 4_000;/);
    expect(idle).toMatch(/opts\.timeoutMs \?\? IDLE_DEFAULT_TIMEOUT_MS/);
  });

  it("realtime aboneliği kısa sınırı AÇIK parametreyle ister (≤1000 ms)", () => {
    const rt = src("src/lib/realtime.ts");
    const call = rt.indexOf("runWhenIdle(");
    expect(call, "realtime.ts runWhenIdle çağırmalı").toBeGreaterThan(-1);
    expect(rt.indexOf("{ timeoutMs: REALTIME_IDLE_TIMEOUT_MS }", call), "runWhenIdle(..., { timeoutMs }) açık parametre").toBeGreaterThan(call);
    const constant = /export const REALTIME_IDLE_TIMEOUT_MS = ([\d_]+);/.exec(rt);
    expect(constant).not.toBeNull();
    expect(Number(constant![1].replace(/_/g, ""))).toBeLessThanOrEqual(1_000);
  });

  it("ikinci argüman yalnız seçenek nesnesi (eski konumsal ms argümanı yok)", () => {
    for (const file of walkSource(resolve(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("runWhenIdle(")) continue;
      expect(text, file).not.toMatch(/runWhenIdle\(\s*[\w.]+\s*,\s*\d/);
    }
  });
});
