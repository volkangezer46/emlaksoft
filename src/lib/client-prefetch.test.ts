import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueIdlePrefetch,
  IDLE_PARTIAL_PATHS,
  idlePrefetchKind,
  isIdlePartialHref,
  prefetchFullNow,
  resetPrefetchState,
  type PrefetchRouter,
} from "@/lib/client-prefetch";

/** KQ5: ağır merkezler boşta yalnız KISMİ; tam yükleme yalnız niyetle (hover/odak). */

function recorder() {
  const calls: { href: string; kind: string }[] = [];
  const router: PrefetchRouter = { prefetch: (href, o) => void calls.push({ href, kind: String(o.kind) }) };
  return { router, calls };
}

describe("ağır sayfa sınıflaması", () => {
  it("müşteriler, komisyon, raporlar boşta kısmi; detay alt yolları ve diğer merkezler tam", () => {
    expect(IDLE_PARTIAL_PATHS).toEqual(["/app/musteriler", "/app/komisyon", "/app/raporlar"]);
    expect(isIdlePartialHref("/app/musteriler")).toBe(true);
    expect(isIdlePartialHref("/app/raporlar?sekme=merkez")).toBe(true);
    expect(isIdlePartialHref("/app/komisyon/#x")).toBe(true);
    expect(isIdlePartialHref("/app/musteriler/123")).toBe(false);
    expect(idlePrefetchKind("/app/portfoyler")).toBe("full");
    expect(idlePrefetchKind("/app/komisyon")).toBe("auto");
  });
});

describe("boşta kuyruk ve niyet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g" } });
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("document", { visibilityState: "visible" });
    resetPrefetchState();
  });
  afterEach(() => {
    resetPrefetchState();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("boşta: ağır merkezler kind=auto, diğerleri kind=full", async () => {
    const { router, calls } = recorder();
    enqueueIdlePrefetch(router, ["/app/portfoyler", "/app/musteriler", "/app/komisyon", "/app/raporlar", "/app/gorevler"]);
    await vi.runAllTimersAsync();
    const byHref = Object.fromEntries(calls.map((c) => [c.href, c.kind]));
    expect(byHref).toEqual({
      "/app/portfoyler": "full",
      "/app/musteriler": "auto",
      "/app/komisyon": "auto",
      "/app/raporlar": "auto",
      "/app/gorevler": "full",
    });
  });

  it("boşta kısmi yükleme, ardından gelen hover'ın TAM yüklemesini engellemez", async () => {
    const { router, calls } = recorder();
    enqueueIdlePrefetch(router, ["/app/musteriler"]);
    await vi.runAllTimersAsync();
    prefetchFullNow(router, "/app/musteriler");
    expect(calls).toEqual([
      { href: "/app/musteriler", kind: "auto" },
      { href: "/app/musteriler", kind: "full" },
    ]);
    // Tekrar hover: tekrar süresi içinde yeniden istenmez.
    prefetchFullNow(router, "/app/musteriler");
    expect(calls).toHaveLength(2);
  });
});
