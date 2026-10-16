import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_CACHE_REFRESHED_EVENT,
  enqueueIdlePrefetch,
  HUB_FULL_COUNT,
  noteCacheInvalidated,
  prefetchFullNow,
  resetPrefetchState,
  takeIdleRowBudget,
  TIER_BUDGET,
  type PrefetchRouter,
} from "@/lib/client-prefetch";

/**
 * B024 / B012: öncelik kuyruğu (kardeş sekmeler → ilk 3 merkez TAM → kalan merkezler yalnız rota ağacı), kademe başına
 * ayrı bütçe, aynı adres kısmi + tam çift çekilmez, önbellek tazelenince "yakın zamanda çekildi" düşer ve etkin
 * merkezin ilk hedefleri yeniden ısınır (sözleşme a: `es:client-cache-refreshed`).
 */

function recorder() {
  const calls: { href: string; kind: string }[] = [];
  const router: PrefetchRouter = { prefetch: (href, o) => void calls.push({ href, kind: String(o.kind) }) };
  return { router, calls };
}

describe("öncelik kuyruğu ve niyet", () => {
  let listeners: Map<string, (() => void)[]>;
  beforeEach(() => {
    vi.useFakeTimers();
    listeners = new Map();
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g" } });
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      addEventListener: (type: string, fn: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    });
    vi.stubGlobal("document", { visibilityState: "visible" });
    resetPrefetchState();
  });
  afterEach(() => {
    resetPrefetchState();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("kardeş sekmeler menü merkezlerinden ÖNCE; ilk 3 merkez TAM, kalanı rota ağacı (auto)", async () => {
    const { router, calls } = recorder();
    // Menü önce kaydolsa da kardeş sekmeler kuyruğun önüne geçer.
    enqueueIdlePrefetch(router, ["/app/musteriler", "/app/portfoyler", "/app/anlasmalar", "/app/finans/komisyon", "/app/raporlar"], "hubs");
    enqueueIdlePrefetch(router, ["/app/randevular", "/app/gorevler"], "siblings");
    await vi.runAllTimersAsync();
    expect(calls).toEqual([
      { href: "/app/randevular", kind: "full" },
      { href: "/app/gorevler", kind: "full" },
      { href: "/app/musteriler", kind: "full" },
      { href: "/app/portfoyler", kind: "full" },
      { href: "/app/anlasmalar", kind: "full" },
      { href: "/app/finans/komisyon", kind: "auto" },
      { href: "/app/raporlar", kind: "auto" },
    ]);
    expect(HUB_FULL_COUNT).toBe(3);
  });

  it("aynı adres kısmi + tam çift çekilmez: TAM kuyruktaki adres ağaç kademesinden düşer", async () => {
    const { router, calls } = recorder();
    enqueueIdlePrefetch(router, ["/app/a", "/app/b", "/app/c", "/app/gorevler"], "hubs"); // gorevler → ağaç
    enqueueIdlePrefetch(router, ["/app/gorevler"], "siblings"); // aynı adres TAM'a yükselir
    await vi.runAllTimersAsync();
    expect(calls.filter((c) => c.href === "/app/gorevler")).toEqual([{ href: "/app/gorevler", kind: "full" }]);
  });

  it("niyetle TAM yüklenen adres sonradan ağaç olarak istenmez; tekrar süresi içinde ikinci TAM yok", async () => {
    const { router, calls } = recorder();
    prefetchFullNow(router, "/app/finans/komisyon");
    enqueueIdlePrefetch(router, ["/app/a", "/app/b", "/app/c", "/app/finans/komisyon"], "hubs");
    await vi.runAllTimersAsync();
    prefetchFullNow(router, "/app/finans/komisyon");
    expect(calls.filter((c) => c.href === "/app/finans/komisyon")).toEqual([{ href: "/app/finans/komisyon", kind: "full" }]);
  });

  it("kademe bütçeleri ayrıdır: merkezler kardeş sekme bütçesini tüketmez", async () => {
    const { router, calls } = recorder();
    const many = Array.from({ length: TIER_BUDGET.tree + HUB_FULL_COUNT + 4 }, (_, i) => `/app/m${i}`);
    enqueueIdlePrefetch(router, many, "hubs");
    enqueueIdlePrefetch(router, ["/app/s1", "/app/s2"], "siblings");
    await vi.runAllTimersAsync();
    expect(calls.filter((c) => c.kind === "auto")).toHaveLength(TIER_BUDGET.tree);
    expect(calls.slice(0, 2).map((c) => c.href)).toEqual(["/app/s1", "/app/s2"]);
  });

  it("kuyruktan çıkarma: merkez değişince eski kardeşlerin başlamamış istekleri düşer", async () => {
    const { router, calls } = recorder();
    const cancel = enqueueIdlePrefetch(router, ["/app/x1", "/app/x2", "/app/x3", "/app/x4"], "siblings");
    cancel();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
  });

  it("önbellek tazelendi olayı: tekrar süresi sıfırlanır, etkin merkezin ilk 3 hedefi 1,5 sn sonra yeniden ısınır", async () => {
    const { router, calls } = recorder();
    enqueueIdlePrefetch(router, ["/app/t1", "/app/t2", "/app/t3", "/app/t4"], "siblings");
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(4);
    // Olay dinleyicisi kaydedildi (sözleşme a).
    expect(listeners.get(CLIENT_CACHE_REFRESHED_EVENT)).toHaveLength(1);
    // Tekrar süresi içinde niyet yeni istek atmaz…
    prefetchFullNow(router, "/app/t4");
    expect(calls).toHaveLength(4);
    // …önbellek düşünce atar; ilk 3 kardeş 1,5 sn sonra yeniden ısınır.
    listeners.get(CLIENT_CACHE_REFRESHED_EVENT)![0]!();
    prefetchFullNow(router, "/app/t4");
    expect(calls).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1_400);
    expect(calls).toHaveLength(5);
    await vi.runAllTimersAsync();
    expect(calls.slice(5).map((c) => c.href)).toEqual(["/app/t1", "/app/t2", "/app/t3"]);
    expect(calls.slice(5).every((c) => c.kind === "full")).toBe(true);
    // En sık 10 sn'de bir: hemen ardından gelen ikinci olay yeniden ısıtmaz.
    noteCacheInvalidated();
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(8);
  });

  it("ilk satır bütçesi: ilk 2 FARKLI adres; aynı adres yeniden sorulunca bütçe harcamadan true", () => {
    expect(takeIdleRowBudget("/app/musteriler?", "/app/musteriler/1", 2)).toBe(true);
    expect(takeIdleRowBudget("/app/musteriler?", "/app/musteriler/1", 2)).toBe(true);
    expect(takeIdleRowBudget("/app/musteriler?", "/app/musteriler/2", 2)).toBe(true);
    expect(takeIdleRowBudget("/app/musteriler?", "/app/musteriler/3", 2)).toBe(false);
    // Başka sayfada bütçe yeniden başlar.
    expect(takeIdleRowBudget("/app/portfoyler?", "/app/portfoyler/9", 2)).toBe(true);
  });

  it("veri tasarrufunda hiçbir şey yapılmaz", async () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const { router, calls } = recorder();
    enqueueIdlePrefetch(router, ["/app/a"], "siblings");
    prefetchFullNow(router, "/app/b");
    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
  });
});
