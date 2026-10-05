import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string | null>());
const notify = vi.hoisted(() => vi.fn(async (_input: unknown) => undefined));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSetting: async (key: string) => store.get(key) ?? null,
  getPlatformSettingsMany: async (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, store.get(k) ?? null])),
  setPlatformSetting: async (key: string, value: string | null) => {
    store.set(key, value);
    return true;
  },
}));
vi.mock("@/lib/platform-notify", () => ({ notifyPlatformStaff: notify }));

import {
  __setEmlakFiyatiAdapterTestHooks,
  emlakFiyatiGet,
  getEmlakFiyatiPeakConcurrency,
  getEmlakFiyatiRequestStats,
  onEmlakFiyatiRequest,
  probeEmlakFiyatiConnection,
  resetEmlakFiyatiStateForTests,
  type EmlakFiyatiRequestEvent,
} from "./adapter";
import { EF_SETTING, invalidateEmlakFiyatiKeyCache, storeNewEmlakFiyatiKey } from "./keys";
import { ALL_FAKE_KEYS, FAKE_ENV_KEY, FAKE_KEY, FAKE_KEY_2, FAKE_SECRETS_KEY } from "./test-fixtures";

const DAY = 86_400_000;

function ok(body: unknown = []) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function bearerOf(call: unknown[]): string {
  return ((call[1] as RequestInit).headers as Record<string, string>).Authorization;
}

describe("EmlakFiyati adaptörü (fetch mock — gerçek anahtar ve gerçek ağ çağrısı yok)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let sleeps: number[];
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
    store.clear();
    notify.mockClear();
    resetEmlakFiyatiStateForTests();
    invalidateEmlakFiyatiKeyCache();
    sleeps = [];
    __setEmlakFiyatiAdapterTestHooks({
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
    });
    vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY);
    vi.stubEnv("EMLAKFIYATI_API_KEY", FAKE_ENV_KEY);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function leakCheck(...extra: unknown[]) {
    const dump = JSON.stringify([
      extra,
      errorSpy.mock.calls,
      notify.mock.calls,
      [...store.entries()].filter(([k]) => k !== EF_SETTING.current && k !== EF_SETTING.previous),
    ]);
    for (const k of ALL_FAKE_KEYS) expect(dump).not.toContain(k);
  }

  it("anahtar yoksa etkin değil döner ve ağa çıkmaz", async () => {
    vi.stubEnv("EMLAKFIYATI_API_KEY", "");
    const res = await emlakFiyatiGet("/api/endeks", { path: "istanbul", tip: "konut" });
    expect(res).toEqual({ ok: false, kind: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isteği yalnız Bearer ile, doğru taban adrese, yönlendirme reddi + no-store ile atar (x-api-key YOK)", async () => {
    fetchMock.mockImplementation(async () => ok([{ a: 1 }]));
    const res = await emlakFiyatiGet("/api/endeks", { tip: "konut", path: "istanbul/kadikoy" });
    expect(res).toMatchObject({ ok: true, status: 200, cached: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://emlakfiyati.com/api/endeks?path=istanbul%2Fkadikoy&tip=konut");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.body).toBeUndefined();
    const names = Object.keys(init.headers as Record<string, string>).map((h) => h.toLowerCase()).sort();
    expect(names).toEqual(["accept", "authorization", "cache-control"]);
    expect(bearerOf([url, init])).toBe(`Bearer ${FAKE_ENV_KEY}`);
  });

  describe("anahtar çözümleme önceliği: admin (şifreli) > ortam > yok", () => {
    it("admin'de kayıtlı anahtar ortam değişkenine üstündür; saklanan değer düz metin değildir", async () => {
      expect(await storeNewEmlakFiyatiKey(FAKE_KEY, "staff-1")).toEqual({ ok: true, rotated: false });
      expect(store.get(EF_SETTING.current)).not.toContain(FAKE_KEY);
      fetchMock.mockImplementation(async () => ok());
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(bearerOf(fetchMock.mock.calls[0]!)).toBe(`Bearer ${FAKE_KEY}`);
    });

    it("admin kaydı yoksa ortam değişkeni YEDEK olarak çalışır", async () => {
      fetchMock.mockImplementation(async () => ok());
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(bearerOf(fetchMock.mock.calls[0]!)).toBe(`Bearer ${FAKE_ENV_KEY}`);
    });

    it("sır anahtarı kaybolduysa (çözülemiyor) ortam değişkenine düşer", async () => {
      await storeNewEmlakFiyatiKey(FAKE_KEY, "staff-1");
      vi.stubEnv("PLATFORM_SECRETS_KEY", "");
      invalidateEmlakFiyatiKeyCache();
      fetchMock.mockImplementation(async () => ok());
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(bearerOf(fetchMock.mock.calls[0]!)).toBe(`Bearer ${FAKE_ENV_KEY}`);
    });
  });

  describe("401", () => {
    it("yeniden deneme YOK, alarm üretir (saatte en çok 1), sonraki çağrı ağa çıkmaz; anahtar hiçbir yerde görünmez", async () => {
      fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
      const res = await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(res).toEqual({ ok: false, kind: "auth", status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleeps).toEqual([]);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0]![0]).toMatchObject({ roles: ["super_admin"], kind: "danger" });
      expect(store.get(EF_SETTING.lastErrorClass)).toBe("auth");

      await emlakFiyatiGet("/api/endeks", { path: "b", tip: "konut" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);

      // Bir saat sonra (blok bitmiş) tekrar 401 olursa yeni bildirim üretilir.
      vi.setSystemTime(new Date("2026-10-05T11:30:00Z"));
      await emlakFiyatiGet("/api/endeks", { path: "c", tip: "konut" });
      expect(notify).toHaveBeenCalledTimes(2);
      leakCheck(res);
    });

    it("yeni anahtar girilince (parmak izi değişir) engel kalkar", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      await storeNewEmlakFiyatiKey(FAKE_KEY, "s");
      fetchMock.mockResolvedValueOnce(ok());
      const res = await emlakFiyatiGet("/api/endeks", { path: "b", tip: "konut" });
      expect(res.ok).toBe(true);
      expect(store.get(EF_SETTING.lastErrorClass)).toBeNull();
    });
  });

  describe("rotasyon", () => {
    async function rotate() {
      await storeNewEmlakFiyatiKey(FAKE_KEY, "s");
      await storeNewEmlakFiyatiKey(FAKE_KEY_2, "s");
    }

    it("current 401 alırsa geçerli previous ile BİR kez denenir, başarıda admin uyarılır, sonraki çağrılar previous ile gider", async () => {
      await rotate();
      fetchMock.mockImplementation(async (_u: string, init: RequestInit) =>
        (init.headers as Record<string, string>).Authorization === `Bearer ${FAKE_KEY}` ? ok() : new Response("", { status: 401 }),
      );
      const res = await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(res.ok).toBe(true);
      expect(fetchMock.mock.calls.map(bearerOf)).toEqual([`Bearer ${FAKE_KEY_2}`, `Bearer ${FAKE_KEY}`]);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0]![0]).toMatchObject({ kind: "warning" });

      await emlakFiyatiGet("/api/endeks", { path: "b", tip: "konut" });
      expect(bearerOf(fetchMock.mock.calls[2]!)).toBe(`Bearer ${FAKE_KEY}`);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      leakCheck();
    });

    it("previous de 401 ise alarm üretilir (toplam 2 istek, başka deneme yok)", async () => {
      await rotate();
      fetchMock.mockResolvedValue(new Response("", { status: 401 }));
      const res = await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(res).toMatchObject({ ok: false, kind: "auth" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(notify.mock.calls.map((c) => (c[0] as { kind: string }).kind)).toEqual(["danger"]);
    });

    it("previous 7 gün saklanır; süre bitince yok sayılır ve silinir", async () => {
      await rotate();
      expect(store.get(EF_SETTING.previousUntil)).toBe(new Date(Date.now() + 7 * DAY).toISOString());

      vi.setSystemTime(new Date(Date.now() + 7 * DAY + 1000));
      invalidateEmlakFiyatiKeyCache();
      fetchMock.mockResolvedValue(new Response("", { status: 401 }));
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(fetchMock).toHaveBeenCalledTimes(1); // previous denenmedi
      await Promise.resolve();
      await Promise.resolve();
      expect(store.get(EF_SETTING.previous)).toBeNull();
    });
  });

  it("403: yeniden deneme yok, kapsam hatası döner", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    const res = await emlakFiyatiGet("/api/ilanlar", { il: "istanbul" });
    expect(res).toEqual({ ok: false, kind: "forbidden", status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("404: not_found (hata alarmı yok)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect(await emlakFiyatiGet("/api/endeks", { path: "x", tip: "konut" })).toMatchObject({ ok: false, kind: "not_found" });
    expect(notify).not.toHaveBeenCalled();
  });

  describe("429 (Retry-After YOK)", () => {
    it("üstel geri çekilme + jitter ile 2 kez yeniden dener, sonra genel soğuma başlar", async () => {
      fetchMock.mockResolvedValue(new Response('{"hata":"istek siniri asildi"}', { status: 429 }));
      const res = await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(res).toMatchObject({ ok: false, kind: "rate_limited" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // random=0.5 -> çarpan 0.75: 500*0.75, 1000*0.75
      expect(sleeps).toEqual([375, 750]);

      // Soğuma süresince başka sorgu ağa çıkmaz.
      await emlakFiyatiGet("/api/endeks", { path: "b", tip: "konut" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("jitter sınırları: random 0 -> yarı süre, random 1 -> tam süre; Retry-After başlığına bakılmaz", async () => {
      fetchMock.mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": "999" } }));
      __setEmlakFiyatiAdapterTestHooks({ random: () => 0 });
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(sleeps).toEqual([250, 500]);

      resetEmlakFiyatiStateForTests();
      sleeps.length = 0;
      __setEmlakFiyatiAdapterTestHooks({
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        random: () => 1,
      });
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(sleeps).toEqual([500, 1000]);
    });

    it("soğuma bittikten sonra çağrılar yeniden ağa çıkar", async () => {
      fetchMock.mockResolvedValue(new Response("", { status: 429 }));
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      vi.setSystemTime(new Date(Date.now() + 6 * 60_000));
      fetchMock.mockImplementation(async () => ok());
      const res = await emlakFiyatiGet("/api/endeks", { path: "b", tip: "konut" });
      expect(res.ok).toBe(true);
    });
  });

  it("aynı anda en çok 4 istek uçuşta olur", async () => {
    const resolvers: Array<() => void> = [];
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve(ok());
          });
        }),
    );
    const calls = Array.from({ length: 10 }, (_, i) => emlakFiyatiGet("/api/endeks", { path: `il${i}`, tip: "konut" }));
    let done = false;
    const all = Promise.all(calls).then((r) => {
      done = true;
      return r;
    });
    for (let i = 0; i < 500 && !done; i += 1) {
      await new Promise((r) => setImmediate(r));
      resolvers.shift()?.();
    }
    const results = await all;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBe(4);
    expect(getEmlakFiyatiPeakConcurrency()).toBe(4);
  });

  describe("5xx / ağ", () => {
    it("5xx sınırlı yeniden denenir (toplam 3 deneme) ve sonunda server döner", async () => {
      fetchMock.mockResolvedValue(new Response("", { status: 503 }));
      const res = await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(res).toMatchObject({ ok: false, kind: "server", status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(sleeps).toHaveLength(2);
    });

    it("geçici 5xx sonrası başarı döner", async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 500 })).mockResolvedValueOnce(ok([1]));
      const res = await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(res).toMatchObject({ ok: true, data: [1] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("ağ hatası fırlatmaz, yeniden dener ve 'network' döner", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const res = await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(res).toEqual({ ok: false, kind: "network" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      leakCheck(res);
    });

    it("bozuk JSON 'invalid_response' döner", async () => {
      fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
      expect(await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" })).toMatchObject({ ok: false, kind: "invalid_response" });
    });
  });

  describe("önbellek", () => {
    it("aynı sorgu (parametre sırası fark etmez) ikinci kez ağa çıkmaz", async () => {
      fetchMock.mockImplementation(async () => ok([1]));
      const a = await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      const b = await emlakFiyatiGet("/api/endeks", { tip: "konut", path: "a" });
      expect(a).toMatchObject({ ok: true, cached: false });
      expect(b).toMatchObject({ ok: true, cached: true, data: [1] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getEmlakFiyatiRequestStats().cacheHits).toBe(1);
    });

    it("eşzamanlı aynı sorgular tek isteğe birleşir; süre dolunca yeniden çekilir; hata önbelleğe yazılmaz", async () => {
      fetchMock.mockImplementation(async () => ok([1]));
      await Promise.all([
        emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" }),
        emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" }),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date(Date.now() + 6 * 60_000));
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      fetchMock.mockResolvedValue(new Response("", { status: 403 }));
      await emlakFiyatiGet("/api/ilanlar", { il: "x" });
      await emlakFiyatiGet("/api/ilanlar", { il: "x" });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("cacheTtlMs: 0 önbelleği kapatır", async () => {
      fetchMock.mockImplementation(async () => ok());
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" }, { cacheTtlMs: 0 });
      await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" }, { cacheTtlMs: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("istek olayı kancası: yalnız gerçek ağ isteklerinde, anahtar/sorgu değeri olmadan çağrılır", async () => {
    const events: EmlakFiyatiRequestEvent[] = [];
    onEmlakFiyatiRequest((e) => events.push(e));
    fetchMock.mockImplementation(async () => ok());
    await emlakFiyatiGet("/api/endeks", { path: "gizli-yol", tip: "konut" });
    await emlakFiyatiGet("/api/endeks", { path: "gizli-yol", tip: "konut" }); // önbellek
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ path: "/api/endeks", status: 200, outcome: "ok", viaPreviousKey: false });
    const dump = JSON.stringify(events);
    expect(dump).not.toContain("gizli-yol");
    for (const k of ALL_FAKE_KEYS) expect(dump).not.toContain(k);
    expect(getEmlakFiyatiRequestStats().total).toBe(1);
  });

  it("kanca hatası adaptörü bozmaz", async () => {
    onEmlakFiyatiRequest(() => {
      throw new Error("boom");
    });
    fetchMock.mockImplementation(async () => ok());
    expect((await emlakFiyatiGet("/api/endeks", { path: "a", tip: "konut" })).ok).toBe(true);
  });

  describe("bağlantı yoklaması (admin)", () => {
    it("başarı: connected; tek istek, doğrulanmış /api/endeks?path=istanbul&tip=konut; son başarı damgası yazılır", async () => {
      fetchMock.mockImplementation(async () => ok([]));
      expect(await probeEmlakFiyatiConnection()).toEqual({ state: "connected" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe("https://emlakfiyati.com/api/endeks?path=istanbul&tip=konut");
      await Promise.resolve();
      expect(store.get(EF_SETTING.lastOkAt)).toBeTruthy();
    });

    it.each([
      [401, "auth"],
      [403, "forbidden"],
      [429, "rate_limited"],
      [502, "server"],
    ])("HTTP %s -> %s; yeniden deneme ve alarm yok", async (status, state) => {
      fetchMock.mockResolvedValue(new Response("", { status }));
      expect(await probeEmlakFiyatiConnection()).toEqual({ state });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(notify).not.toHaveBeenCalled();
    });

    it("ağ hatası: network; anahtar yok: disabled", async () => {
      fetchMock.mockRejectedValue(new TypeError("down"));
      expect(await probeEmlakFiyatiConnection()).toEqual({ state: "network" });
      vi.stubEnv("EMLAKFIYATI_API_KEY", "");
      invalidateEmlakFiyatiKeyCache();
      expect(await probeEmlakFiyatiConnection()).toEqual({ state: "disabled" });
    });
  });
});
