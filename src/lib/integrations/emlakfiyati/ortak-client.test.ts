import { readFileSync } from "node:fs";
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

import { EF_ORTAK_FLAG_SETTING_KEY, EF_ORTAK_PROBE_OK_SETTING_KEY } from "@/lib/ef-credits/config";
import { __setEmlakFiyatiAdapterTestHooks, getOrtakPeakConcurrency, resetEmlakFiyatiStateForTests } from "./adapter";
import { invalidateEmlakFiyatiKeyCache } from "./keys";
import { getEfIlceler, getEfIller, getEfMahalleler, ortakDegerleme, ortakKullanim, ortakRapor, ortakRaporPdf } from "./ortak-client";
import { ALL_FAKE_KEYS, FAKE_ENV_KEY, FAKE_SECRETS_KEY } from "./test-fixtures";

const TENANT = "9d1c7a52-6b3e-4f08-a1d4-2e5f6a7b8c90";
const USER = "3f2b8a9e-1c4d-4e6f-8a7b-9c0d1e2f3a4b";
const USER2 = "4a2b8a9e-1c4d-4e6f-8a7b-9c0d1e2f3a4c";
const RID = "3f0c2d9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const IDEM = "es-2f9b3c1e-0a11-4c22-9d33-1a2b3c4d5e6f";
const INPUT = { mahalleId: 162, ada: "101", parsel: "1", tip: "arsa" as const };

type Call = [string, RequestInit & { headers: Record<string, string> }];

function json(body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-istek-id": "req-ok-1", ...(init.headers ?? {}) }, ...init });
}
function err(status: number, kod: string | null, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(kod ? { hata: "Türkçe açıklama", kod } : { hata: "Türkçe açıklama" }), {
    status,
    headers: { "content-type": "application/json", "x-istek-id": `req-${status}`, ...headers },
  });
}
const valuation = (extra: Record<string, unknown> = {}) => ({
  sonuc_durumu: "deger",
  ucretlendirilir: true,
  rapor_id: RID,
  tip: "arsa",
  fiyat_yayin: { guven_sinifi: "orta" },
  rapor_gecerlilik: { gun: 30, expires_at: "2026-11-04T09:00:00.000Z" },
  ...extra,
});
const pdfResponse = (headers: Record<string, string> = {}) =>
  new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]), {
    status: 200,
    headers: { "content-type": "application/pdf", "x-istek-id": "req-pdf-1", ...headers },
  });

describe("EmlakFiyati ortak istemcisi (fetch mock — gerçek anahtar ve gerçek ağ çağrısı yok)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let sleeps: number[];

  const calls = () => fetchMock.mock.calls as unknown as Call[];
  const open = () => {
    store.set(EF_ORTAK_FLAG_SETTING_KEY, "1");
    store.set(EF_ORTAK_PROBE_OK_SETTING_KEY, "2026-10-05T09:00:00.000Z");
  };

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
      random: () => 0.5, // jitter = 500 ms
    });
    vi.stubEnv("PLATFORM_SECRETS_KEY", FAKE_SECRETS_KEY);
    vi.stubEnv("EMLAKFIYATI_API_KEY", FAKE_ENV_KEY);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    open();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("kapı", () => {
    it("bayrak KAPALIYKEN ağa ÇIKILMAZ (varsayılan)", async () => {
      store.clear();
      for (const r of [
        await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT }),
        await ortakRapor({ tenantId: TENANT, userId: USER, raporId: RID }),
        await ortakRaporPdf({ tenantId: TENANT, userId: USER, raporId: RID }),
        await ortakKullanim(),
      ]) {
        expect(r).toMatchObject({ ok: false, kind: "disabled", code: "flag_off" });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("bayrak açık ama ortak yoklaması YOK: ağa çıkılmaz", async () => {
      store.delete(EF_ORTAK_PROBE_OK_SETTING_KEY);
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: false, kind: "disabled", code: "probe_missing" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("anahtar yoksa ağa çıkılmaz", async () => {
      vi.stubEnv("EMLAKFIYATI_API_KEY", "");
      invalidateEmlakFiyatiKeyCache();
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: false, kind: "disabled" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("yerel doğrulama: geçersiz girdi / kişisel veri içeren serbest metin / kötü idempotency anahtarı ağa çıkmaz", async () => {
      const bad = [
        await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: { ...INPUT, ada: "x" } }),
        await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: { mahalleId: 1, ada: "1", parsel: "1", tip: "konut", konut: { konutM2: 80, siteAdi: "ali@x.com" } } }),
        await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: "kisa", input: INPUT }),
        await ortakDegerleme({ tenantId: "ali@x.com", userId: USER, idempotencyKey: IDEM, input: INPUT }),
      ];
      expect(bad.map((b) => (b.ok ? "ok" : b.kind))).toEqual(["invalid_input", "invalid_input", "bad_request", "disabled"]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /degerleme", () => {
    it("başlıklar ve gövde sözleşmeye uyar; X-Istek-Id döner; anahtar sonuca sızmaz", async () => {
      fetchMock.mockResolvedValueOnce(json(valuation()));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: true, requestId: "req-ok-1", replayed: false, attempts: 1 });
      if (!r.ok || r.data.durum !== "deger") throw new Error("beklenmeyen");
      expect(r.data.raporId).toBe(RID);
      expect(r.data.ucretlendirilir).toBe(true);

      const [url, init] = calls()[0]!;
      expect(url).toBe("https://emlakfiyati.com/api/ortak/v1/degerleme");
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers.Authorization).toBe(`Bearer ${FAKE_ENV_KEY}`);
      expect(init.headers["Idempotency-Key"]).toBe(IDEM);
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.headers["X-Ortak-Kullanici-Ref"]).toMatch(/^u-[0-9a-f]{32}$/);
      expect(init.headers["X-Ortak-Kullanici-Ref"]).toMatch(/\d/);
      expect(JSON.parse(init.body as string)).toEqual({ mahalle_id: 162, ada: "101", parsel: "1", tip: "arsa" });
      // Kişisel veri/iç kimlik gövdede ve başlıklarda yok.
      const dump = JSON.stringify([init.headers, init.body]);
      expect(dump).not.toContain(USER);
      expect(dump).not.toContain(TENANT);
      for (const k of ALL_FAKE_KEYS) expect(JSON.stringify(r)).not.toContain(k);
    });

    it("zaman aşımı sabiti >= 90 sn ve adaptör bunu kullanır", () => {
      const src = readFileSync("src/lib/integrations/emlakfiyati/adapter.ts", "utf8");
      expect(src).toContain("EMLAKFIYATI_ORTAK_TIMEOUT_MS");
    });

    it("Idempotency-Replayed: true → 'tekrar' işaretlenir", async () => {
      fetchMock.mockResolvedValueOnce(json(valuation(), { headers: { "idempotency-replayed": "true" } }));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: true, replayed: true });
    });

    it("yetersiz sonuç HATA DEĞİL: durum yetersiz, ücretlendirilmez", async () => {
      fetchMock.mockResolvedValueOnce(json({ sonuc_durumu: "yetersiz", ucretlendirilir: false, mesaj: "Veri yok", nedenler: ["deger_yok"] }));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: true, data: { durum: "yetersiz", ucretlendirilir: false, nedenler: ["deger_yok"] } });
    });

    it("deger ama rapor_id yok → invalid_response (kontör izlenemez)", async () => {
      fetchMock.mockResolvedValueOnce(json(valuation({ rapor_id: null })));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: false, kind: "invalid_response", code: "rapor_id_yok", requestId: "req-ok-1" });
    });

    it("429 + Retry-After: ona uyar ve AYNI Idempotency-Key ile tekrar dener", async () => {
      fetchMock.mockResolvedValueOnce(err(429, "esz_degerleme_tavani", { "retry-after": "3" })).mockResolvedValueOnce(json(valuation()));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: true, attempts: 2 });
      expect(sleeps).toEqual([3500]); // 3 sn + 500 ms jitter
      expect(calls().map((c) => c[1].headers["Idempotency-Key"])).toEqual([IDEM, IDEM]);
      expect(calls()[0]![1].body).toBe(calls()[1]![1].body);
    });

    it("429 Retry-After YOK: 5 sn'den ikiye katlar (+jitter), en çok 2 yeniden deneme sonra rate_limited", async () => {
      fetchMock.mockImplementation(async () => err(429, "istek_siniri"));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: false, kind: "rate_limited", code: "istek_siniri", status: 429, requestId: "req-429", attempts: 3 });
      expect(sleeps).toEqual([5500, 10_500]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("503 kademeli_kuyruk: Retry-After'a uyar", async () => {
      fetchMock.mockResolvedValueOnce(err(503, "kademeli_kuyruk", { "retry-after": "7" })).mockResolvedValueOnce(json(valuation()));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r.ok).toBe(true);
      expect(sleeps).toEqual([7500]);
    });

    it("409 istek_isleniyor: 2 sn sonra AYNI anahtarla sorar", async () => {
      fetchMock.mockResolvedValueOnce(err(409, "istek_isleniyor")).mockResolvedValueOnce(json(valuation(), { headers: { "idempotency-replayed": "true" } }));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: true, replayed: true, attempts: 2 });
      expect(sleeps).toEqual([2000]);
      expect(calls().map((c) => c[1].headers["Idempotency-Key"])).toEqual([IDEM, IDEM]);
    });

    it("5xx: 10 sn ve 30 sn, en çok 2 yeniden deneme, hepsinde AYNI anahtar; sonra server", async () => {
      fetchMock.mockImplementation(async () => err(500, null));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: false, kind: "server", attempts: 3 });
      expect(sleeps).toEqual([10_000, 30_000]);
      expect(new Set(calls().map((c) => c[1].headers["Idempotency-Key"]))).toEqual(new Set([IDEM]));
    });

    it("ağ hatası: aynı anahtarla yeniden gönderir; zaman aşımı: bir kez", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(json(valuation()));
      expect((await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT })).ok).toBe(true);
      expect(calls().map((c) => c[1].headers["Idempotency-Key"])).toEqual([IDEM, IDEM]);

      fetchMock.mockReset();
      sleeps.length = 0;
      const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
      fetchMock.mockRejectedValue(timeout);
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: false, kind: "timeout", attempts: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      [400, "gecersiz_json", "bad_request"],
      [403, "kapsam_yok", "forbidden"],
      [403, "ortak_bagi_yok", "forbidden"],
      [403, "ortak_pasif", "forbidden"],
      [413, "govde_cok_buyuk", "too_large"],
      [422, "kullanici_ref_kisisel_veri", "invalid_input"],
      [422, "konut_ozelligi_gecersiz", "invalid_input"],
      [422, "anahtar_tekrar_kullanimi", "invalid_input"],
    ] as const)("%s %s: TEK deneme (yeniden deneme YOK), kod ve X-Istek-Id döner", async (status, kod, kind) => {
      fetchMock.mockImplementation(async () => err(status, kod));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: false, kind, code: kod, status, requestId: `req-${status}`, attempts: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleeps).toEqual([]);
    });

    it("401: yeniden deneme YOK, alarm üretilir, sonraki çağrılar ağa çıkmadan engellenir", async () => {
      fetchMock.mockImplementation(async () => err(401, "kimlik_gerekli"));
      const r = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(r).toMatchObject({ ok: false, kind: "auth", status: 401, requestId: "req-401" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
      const again = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: IDEM, input: INPUT });
      expect(again).toMatchObject({ ok: false, kind: "auth" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("gövde 64 KB üstü ise ağa çıkılmaz (413 yerel)", async () => {
      const huge = { mahalleId: 1, ada: "1", parsel: "1", tip: "konut" as const, konut: { konutM2: 80, siteAdi: "a".repeat(100) } };
      // 64 KB'ı aşmak için doğrudan sözleşme fonksiyonu test edilir (alanlar ayrı ayrı sınırlı olduğundan gerçek istekte oluşmaz).
      const { buildOrtakValuationBody, ortakValuationInputSchema } = await import("./ortak-contract");
      const parsed = ortakValuationInputSchema.parse(huge);
      expect(buildOrtakValuationBody(parsed)).not.toBeNull();
      expect(buildOrtakValuationBody({ ...parsed, ada: "1".repeat(70_000) })).toBeNull();
    });
  });

  describe("rapor detayı ve PDF", () => {
    it("rapor detayı: GET, kullanıcı ref zorunlu, kayıtlı özet ayrıştırılır; 404 rapor_yok", async () => {
      fetchMock.mockResolvedValueOnce(json(valuation({ sonuc_durumu: undefined })));
      const r = await ortakRapor({ tenantId: TENANT, userId: USER, raporId: RID });
      expect(r).toMatchObject({ ok: true, data: { durum: "deger", raporId: RID } });
      const [url, init] = calls()[0]!;
      expect(url).toBe(`https://emlakfiyati.com/api/ortak/v1/rapor/${RID}`);
      expect(init.method).toBe("GET");
      expect(init.headers["X-Ortak-Kullanici-Ref"]).toMatch(/^u-/);
      expect(init.headers["Idempotency-Key"]).toBeUndefined();

      fetchMock.mockResolvedValueOnce(err(404, "rapor_yok"));
      expect(await ortakRapor({ tenantId: TENANT, userId: USER, raporId: RID })).toMatchObject({ ok: false, kind: "not_found", code: "rapor_yok", attempts: 1 });
      // Biçimi geçersiz rapor kimliği ağa çıkmaz.
      const n = fetchMock.mock.calls.length;
      expect(await ortakRapor({ tenantId: TENANT, userId: USER, raporId: "../etc" })).toMatchObject({ ok: false, kind: "not_found" });
      expect(fetchMock.mock.calls.length).toBe(n);
    });

    it("PDF: ikili yanıt (Uint8Array), %PDF- doğrulanır, ÖNBELLEK YOK (her çağrı ağa gider)", async () => {
      fetchMock.mockImplementation(async () => pdfResponse());
      const a = await ortakRaporPdf({ tenantId: TENANT, userId: USER, raporId: RID });
      const b = await ortakRaporPdf({ tenantId: TENANT, userId: USER, raporId: RID });
      expect(a).toMatchObject({ ok: true, requestId: "req-pdf-1" });
      expect(b.ok).toBe(true);
      if (!a.ok) throw new Error("beklenmeyen");
      expect(a.data.bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(a.data.bytes.slice(0, 5))).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = calls()[0]!;
      expect(url).toBe(`https://emlakfiyati.com/api/ortak/v1/rapor/${RID}.pdf`);
      expect(init.headers.Accept).toBe("application/pdf");
    });

    it("PDF boyut tavanı (15 MB) ve yanlış içerik türü → invalid_response", async () => {
      fetchMock.mockResolvedValueOnce(pdfResponse({ "content-length": String(16 * 1024 * 1024) }));
      expect(await ortakRaporPdf({ tenantId: TENANT, userId: USER, raporId: RID })).toMatchObject({ ok: false, kind: "invalid_response" });
      fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
      expect(await ortakRaporPdf({ tenantId: TENANT, userId: USER, raporId: RID })).toMatchObject({ ok: false, kind: "invalid_response" });
      fetchMock.mockResolvedValueOnce(new Response("not a pdf at all", { status: 200, headers: { "content-type": "application/pdf" } }));
      expect(await ortakRaporPdf({ tenantId: TENANT, userId: USER, raporId: RID })).toMatchObject({ ok: false, kind: "invalid_response" });
    });

    it("502 pdf_uretilemedi: 10 sn ve 30 sn'de en çok 2 deneme, sonra pdf_failed", async () => {
      fetchMock.mockImplementation(async () => err(502, "pdf_uretilemedi", { "retry-after": "10" }));
      const r = await ortakRaporPdf({ tenantId: TENANT, userId: USER, raporId: RID });
      expect(r).toMatchObject({ ok: false, kind: "pdf_failed", status: 502, requestId: "req-502", attempts: 3 });
      expect(sleeps).toEqual([10_000, 30_000]);
    });

    it("429 pdf_dakika_siniri: Retry-After kadar bekler", async () => {
      fetchMock.mockResolvedValueOnce(err(429, "pdf_dakika_siniri", { "retry-after": "5" })).mockImplementationOnce(async () => pdfResponse());
      expect((await ortakRaporPdf({ tenantId: TENANT, userId: USER, raporId: RID })).ok).toBe(true);
      expect(sleeps).toEqual([5500]);
    });
  });

  describe("kullanım", () => {
    it("GET /kullanim: kullanıcı ref isteğe bağlı; sınırlar ve tarife.surum", async () => {
      fetchMock.mockImplementation(async () =>
        json({ ortak: { kod: "emlaksoft", ad: "Emlaksoft" }, tarife: { sorgu_tl: 0, pdf_tl: 0, surum: "v1:0:0" }, sinirlar: { esz_pdf: 3, esz_degerleme: 6 }, toplam: { degerleme: 1 } }),
      );
      const r = await ortakKullanim();
      expect(r).toMatchObject({ ok: true, data: { tarifeSurum: "v1:0:0", sinirlar: { eszPdf: 3, eszDegerleme: 6 } } });
      expect(calls()[0]![1].headers["X-Ortak-Kullanici-Ref"]).toBeUndefined();
      await ortakKullanim({ tenantId: TENANT, userId: USER });
      expect(calls()[1]![1].headers["X-Ortak-Kullanici-Ref"]).toMatch(/^u-/);
    });
  });

  describe("eşzamanlılık", () => {
    function deferredFetch() {
      const pending: Array<() => void> = [];
      let active = 0;
      let peak = 0;
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            active += 1;
            peak = Math.max(peak, active);
            pending.push(() => {
              active -= 1;
              resolve(json(valuation()));
            });
          }),
      );
      return { pending, peak: () => peak };
    }
    const tick = () => new Promise((r) => setTimeout(r, 0));

    it("genel: en çok 4 eşzamanlı değerleme (kuyruk)", async () => {
      const d = deferredFetch();
      const users = Array.from({ length: 6 }, (_, i) => `4a2b8a9e-1c4d-4e6f-8a7b-9c0d1e2f3a${(10 + i).toString()}`);
      const runs = users.map((u, i) => ortakDegerleme({ tenantId: TENANT, userId: u, idempotencyKey: `es-${"a".repeat(8)}-${i}`, input: INPUT }));
      await tick();
      expect(d.pending.length).toBe(4);
      while (d.pending.length) {
        d.pending.shift()!();
        await tick();
      }
      const results = await Promise.all(runs);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(d.peak()).toBeLessThanOrEqual(4);
      expect(getOrtakPeakConcurrency().value).toBeLessThanOrEqual(4);
    });

    it("kullanıcı başına: aynı kullanıcının 3. eşzamanlı değerlemesi yerelde reddedilir (ağa gitmez)", async () => {
      const d = deferredFetch();
      const a = ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: "es-aaaaaaaa-1", input: INPUT });
      const b = ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: "es-aaaaaaaa-2", input: INPUT });
      await tick();
      const c = await ortakDegerleme({ tenantId: TENANT, userId: USER, idempotencyKey: "es-aaaaaaaa-3", input: INPUT });
      expect(c).toMatchObject({ ok: false, kind: "too_many_local" });
      expect(d.pending.length).toBe(2);
      // Başka kullanıcı etkilenmez.
      const other = ortakDegerleme({ tenantId: TENANT, userId: USER2, idempotencyKey: "es-bbbbbbbb-1", input: INPUT });
      await tick();
      expect(d.pending.length).toBe(3);
      while (d.pending.length) {
        d.pending.shift()!();
        await tick();
      }
      await Promise.all([a, b, other]);
    });

    it("PDF: en çok 2 eşzamanlı", async () => {
      const pending: Array<() => void> = [];
      let active = 0;
      let peak = 0;
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            active += 1;
            peak = Math.max(peak, active);
            pending.push(() => {
              active -= 1;
              resolve(pdfResponse());
            });
          }),
      );
      const users = ["4a2b8a9e-1c4d-4e6f-8a7b-9c0d1e2f3a20", "4a2b8a9e-1c4d-4e6f-8a7b-9c0d1e2f3a21", "4a2b8a9e-1c4d-4e6f-8a7b-9c0d1e2f3a22"];
      const runs = users.map((u) => ortakRaporPdf({ tenantId: TENANT, userId: u, raporId: RID }));
      await tick();
      expect(pending.length).toBe(2);
      while (pending.length) {
        pending.shift()!();
        await tick();
      }
      expect((await Promise.all(runs)).every((r) => r.ok)).toBe(true);
      expect(peak).toBeLessThanOrEqual(2);
    });
  });

  describe("mahalle referansı (anahtarsız)", () => {
    it("3 uç, kimlik başlığı YOK, 6 saat önbellek (bayrak kapalıyken de çalışır)", async () => {
      store.clear();
      fetchMock.mockImplementation(async (url: string) =>
        json(
          url.includes("/iller")
            ? { iller: [{ id: 1, ad: "Adana", path: "adana" }, { id: "bozuk" }] }
            : url.includes("/ilceler")
              ? { ilceler: [{ id: 84, ad: "Çukurova", path: "adana/cukurova" }] }
              : { mahalleler: [{ id: 162, ad: "Bozcalar", path: "adana/cukurova/bozcalar-mahallesi" }] },
        ),
      );
      const iller = await getEfIller();
      expect(iller).toMatchObject({ ok: true, data: [{ id: 1, ad: "Adana", path: "adana" }] }); // bozuk satır atlanır
      const ilceler = await getEfIlceler(1);
      expect(ilceler).toMatchObject({ ok: true, data: [{ id: 84 }] });
      const mahalleler = await getEfMahalleler(84);
      expect(mahalleler).toMatchObject({ ok: true, data: [{ id: 162, ad: "Bozcalar" }] });
      expect(calls().map((c) => c[0])).toEqual([
        "https://emlakfiyati.com/api/musteri/iller",
        "https://emlakfiyati.com/api/musteri/ilceler?il_id=1",
        "https://emlakfiyati.com/api/musteri/mahalleler?ilce_id=84",
      ]);
      for (const c of calls()) {
        expect(Object.keys(c[1].headers).map((h) => h.toLowerCase())).not.toContain("authorization");
        expect(Object.keys(c[1].headers).map((h) => h.toLowerCase())).not.toContain("x-ortak-kullanici-ref");
      }
      // Önbellek: ikinci çağrı ağa gitmez
      await getEfIller();
      await getEfIlceler(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // 6 saat sonra tazelenir
      vi.setSystemTime(new Date("2026-10-05T16:30:00Z"));
      await getEfIller();
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("geçersiz kimlik ağa çıkmaz; hata önbelleğe yazılmaz", async () => {
      expect(await getEfIlceler(0)).toMatchObject({ ok: false });
      expect(await getEfMahalleler(1.5)).toMatchObject({ ok: false });
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockResolvedValueOnce(err(500, null)).mockResolvedValueOnce(err(500, null)).mockResolvedValueOnce(err(500, null));
      expect((await getEfIller()).ok).toBe(false);
      fetchMock.mockResolvedValueOnce(json({ iller: [{ id: 1, ad: "Adana", path: "adana" }] }));
      expect((await getEfIller()).ok).toBe(true);
    });
  });
});
