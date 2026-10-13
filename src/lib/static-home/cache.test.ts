import { describe, expect, it } from "vitest";
import { createStaticCache, createWarmLock, mapWithConcurrency, type RenderOutcome } from "./cache";

function setup(opts: { rev?: { value: number | null } } = {}) {
  let t = 1_000_000;
  let version = 0;
  const calls: string[] = [];
  const cache = createStaticCache({
    nowMs: () => t,
    render: async (id): Promise<RenderOutcome> => {
      calls.push(id);
      return { html: `<html>${id} v${version}</html>`, isStatic: true };
    },
    readRev: opts.rev ? async () => opts.rev!.value : undefined,
  });
  return {
    cache,
    calls,
    advance: (ms: number) => (t += ms),
    publish: () => version++,
  };
}

describe("statik önbellek", () => {
  it("anahtar kimliktir; eşzamanlı istekler tek çizimi bekler", async () => {
    const s = setup();
    const [a, b] = await Promise.all([s.cache.get("home"), s.cache.get("home")]);
    expect(a.etag).toBe(b.etag);
    expect(s.calls).toEqual(["home"]);
  });

  it("invalidate sonrası ilk istek yeniden çizer ve yeni ETag döner", async () => {
    const s = setup();
    const first = await s.cache.get("gizlilik");
    s.publish();
    expect((await s.cache.get("gizlilik")).etag).toBe(first.etag); // önbellekten
    s.cache.invalidate("gizlilik");
    const next = await s.cache.get("gizlilik");
    expect(next.etag).not.toBe(first.etag);
    expect(s.calls).toEqual(["gizlilik", "gizlilik"]);
  });

  it("süren çizim invalidate'den sonra önbelleğe yazılmaz", async () => {
    let release: (v: RenderOutcome) => void = () => {};
    let n = 0;
    const cache = createStaticCache({
      nowMs: () => 0,
      render: () => (n++ === 0 ? new Promise<RenderOutcome>((r) => (release = r)) : Promise.resolve({ html: "yeni", isStatic: true })),
    });
    const stale = cache.get("home");
    await new Promise((r) => setTimeout(r, 0)); // çizim başladı
    cache.invalidate("home");
    release({ html: "eski", isStatic: true });
    expect((await stale).html).toBe("eski");
    expect((await cache.get("home")).html).toBe("yeni");
  });

  it("statik.rev değişince (başka süreç) tüm önbellek düşer; 5 sn TTL sahte saatle", async () => {
    const rev = { value: 3 as number | null };
    const s = setup({ rev });
    const first = await s.cache.get("home");
    s.publish();
    rev.value = 4;
    s.advance(2_000); // TTL dolmadı: rev okunmaz, eski içerik
    expect((await s.cache.get("home")).etag).toBe(first.etag);
    s.advance(3_500); // TTL doldu: rev farkı görülür
    const fresh = await s.cache.get("home");
    expect(fresh.etag).not.toBe(first.etag);
    expect(s.calls).toEqual(["home", "home"]);
  });

  it("rev okunamazsa (null) önbellek düşmez; kendi artırımı noteRev ile çift temizlik yapmaz", async () => {
    const rev = { value: 1 as number | null };
    const s = setup({ rev });
    await s.cache.get("home");
    rev.value = null;
    s.advance(10_000);
    await s.cache.get("home");
    expect(s.calls).toEqual(["home"]);
    rev.value = 2;
    s.cache.noteRev(2);
    s.advance(10_000);
    await s.cache.get("home");
    expect(s.calls).toEqual(["home"]);
  });

  it("60 sn sonra eski içerik sunulur ve arka planda yenilenir; yedeğe düşme nedeni kaydedilir", async () => {
    let fail = false;
    let t = 0;
    const cache = createStaticCache({
      nowMs: () => t,
      render: async () => (fail ? { html: "normal", isStatic: false, reason: "beklenmeyen biçim" } : { html: "statik", isStatic: true }),
    });
    await cache.get("gizlilik");
    fail = true;
    t += 61_000;
    expect((await cache.get("gizlilik")).html).toBe("statik");
    await new Promise((r) => setTimeout(r, 0));
    expect((await cache.get("gizlilik")).html).toBe("normal");
    const snap = cache.snapshot("gizlilik");
    expect(snap.stats.lastStatic).toBe(false);
    expect(snap.stats.lastFallbackReason).toBe("beklenmeyen biçim");
  });

  it("LRU en çok 32 girdi", async () => {
    const cache = createStaticCache({ nowMs: () => 0, render: async (id) => ({ html: id, isStatic: true }) });
    for (let i = 0; i < 40; i++) await cache.get(`k${i}`);
    expect(cache.size()).toBe(32);
    expect(cache.snapshot("k0").cached).toBeNull();
    expect(cache.snapshot("k39").cached).not.toBeNull();
  });
});

describe("temizle ve ısıt kilidi (F6)", () => {
  it("eşzamanlı ikinci istek reddedilir; bitince dakika dolmadan yine reddedilir", () => {
    let t = 0;
    const lock = createWarmLock({ nowMs: () => t });
    expect(lock.tryAcquire().ok).toBe(true);
    expect(lock.tryAcquire()).toMatchObject({ ok: false, reason: "running" });
    lock.release();
    t += 30_000;
    expect(lock.tryAcquire()).toMatchObject({ ok: false, reason: "too_soon", retryInSec: 30 });
    t += 30_000;
    expect(lock.tryAcquire().ok).toBe(true);
  });

  it("paralellik sınırı ve sıra korunur", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});
