import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ set: vi.fn(async () => true), get: vi.fn(async () => null as string | null) }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  // Test ortamında önbellek geçişli: her çağrı doğrudan işlevi çalıştırır.
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/platform-settings", () => ({
  setPlatformSetting: settings.set,
  getPlatformSetting: settings.get,
}));

import {
  getEndeks,
  getEndeksForPlace,
  isEmlakFiyatiConfigured,
  resetEmlakFiyatiStateForTests,
} from "./client";

const FAKE_KEY = "test-key-not-real";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

const sampleRow = {
  path: "istanbul/kadikoy",
  ad: "Kadıköy",
  level: 2,
  tip: "konut",
  donem: "2026-10-01",
  n: 110,
  medyan_tl_m2: 185417,
  p25: 142557,
  p75: 219833,
  ort_m2: 121,
  medyan_fiyat: 20_000_000,
  aylik_degisim: 1.2,
  yillik_degisim: null,
  kalibre_tl_m2: 185417,
  guven: "high",
  yetersiz_orneklem: false,
};

describe("EmlakFiyati istemcisi (fetch mock — gerçek API çağrısı yok)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetEmlakFiyatiStateForTests();
    settings.set.mockClear();
    vi.stubEnv("EMLAKFIYATI_API_KEY", FAKE_KEY);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("anahtar yoksa etkin değil döner ve ağ çağrısı yapmaz", async () => {
    vi.stubEnv("EMLAKFIYATI_API_KEY", "");
    expect(isEmlakFiyatiConfigured()).toBe(false);
    expect(await getEndeks({ path: "istanbul/kadikoy", tip: "konut" })).toEqual({ status: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doğru adrese Bearer anahtarıyla, yönlendirme reddi ve no-store ile istek atar; özet döner", async () => {
    fetchMock.mockResolvedValue(jsonResponse([sampleRow]));
    const res = await getEndeks({ path: "istanbul/kadikoy", tip: "konut" });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.summary.medianM2).toBe(185417);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://emlakfiyati.com/api/endeks?path=istanbul%2Fkadikoy&tip=konut");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.body).toBeUndefined();
    expect(settings.set).toHaveBeenCalledWith("emlakfiyati_last_ok_at", expect.any(String));
  });

  it("boş dizi ve 404 'veri yok' sayılır", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    expect((await getEndeks({ path: "aydin/didim", tip: "konut" })).status).toBe("empty");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect((await getEndeks({ path: "aydin/didim", tip: "arsa" })).status).toBe("empty");
  });

  it("geçersiz yol istek atmadan veri yok döner", async () => {
    expect((await getEndeks({ path: "../x", tip: "konut" })).status).toBe("empty");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401 hata döner ve kısa negatif önbellekle aynı yol için tekrar çağrı yapmaz; anahtar loga düşmez", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    expect((await getEndeks({ path: "istanbul/kadikoy", tip: "konut" })).status).toBe("error");
    expect((await getEndeks({ path: "istanbul/kadikoy", tip: "konut" })).status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain(FAKE_KEY);
  });

  it("429 Retry-After'a saygı gösterir: bekleme süresince hiçbir yola çağrı yapılmaz", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": "120" } }));
    expect((await getEndeks({ path: "istanbul/kadikoy", tip: "konut" })).status).toBe("error");
    expect((await getEndeks({ path: "ankara/cankaya", tip: "konut" })).status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bozuk yanıt gövdesi ve ağ hatası fırlatmaz, error döner", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hata: true }));
    expect((await getEndeks({ path: "a/b", tip: "konut" })).status).toBe("error");
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await getEndeks({ path: "c/d", tip: "konut" })).status).toBe("error");
  });

  it("mahalle verisi yoksa ilçeye iner; hata olursa üst seviyeye inmez", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse([sampleRow]));
    const res = await getEndeksForPlace({ province: "İstanbul", district: "Kadıköy", neighborhood: "Moda", tip: "konut" });
    expect(res.status).toBe("ok");
    expect(res.requestedPath).toBe("istanbul/kadikoy/moda");
    const paths = fetchMock.mock.calls.map((c) => new URL(c[0] as string).searchParams.get("path"));
    expect(paths).toEqual(["istanbul/kadikoy/moda", "istanbul/kadikoy"]);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const failed = await getEndeksForPlace({ province: "Ankara", district: "Çankaya", tip: "konut" });
    expect(failed.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
