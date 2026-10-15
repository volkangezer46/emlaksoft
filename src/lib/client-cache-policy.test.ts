import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BG_REFRESH_MIN_GAP_MS,
  decideArrival,
  isGatePath,
  isGateRedirectAfterRefresh,
  isWorkQueuePath,
  networkAllowsPrefetch,
  REVALIDATE_AFTER_MS,
  WORK_QUEUE_BG_REFRESH_MIN_GAP_MS,
  WORK_QUEUE_REVALIDATE_AFTER_MS,
} from "@/lib/client-cache-policy";
import {
  CLIENT_CACHE_REFRESHED_EVENT,
  clearClientCacheState,
  getInvalidatedAt,
  invalidateClientCache,
  noteClientCacheRefreshed,
} from "@/lib/client-cache-state";

describe("client-cache-state: sözleşme (a) ve geçersizleme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearClientCacheState();
  });

  it("noteClientCacheRefreshed 'es:client-cache-refreshed' olayını tazelenen adresle yayar", () => {
    const events: Array<{ type: string; detail: unknown }> = [];
    vi.stubGlobal("window", { dispatchEvent: (e: CustomEvent) => (events.push({ type: e.type, detail: e.detail }), true) });
    noteClientCacheRefreshed("/app/gorevler?");
    expect(CLIENT_CACHE_REFRESHED_EVENT).toBe("es:client-cache-refreshed");
    expect(events).toEqual([{ type: "es:client-cache-refreshed", detail: { key: "/app/gorevler?" } }]);
  });

  it("geçersizleme rota önekine uygulanır; '/app' yalnız tam eşleşir; tazeleme kayıtları siler", () => {
    invalidateClientCache(["/app", "/app/gorevler"]);
    expect(getInvalidatedAt("/app?")).toBeDefined();
    expect(getInvalidatedAt("/app/gorevler?filter=today")).toBeDefined();
    expect(getInvalidatedAt("/app/musteriler?")).toBeUndefined();
    noteClientCacheRefreshed("/app/x?");
    expect(getInvalidatedAt("/app/gorevler?")).toBeUndefined();
  });
});

describe("decideArrival (önce göster, sonra tazele)", () => {
  const base = { nowMs: 1_000_000, lastBgRefreshAt: null, hidden: false };
  it("ilk ziyaret: yalnız işaretle", () => {
    expect(decideArrival({ ...base, fetchedAt: undefined })).toBe("mark");
  });
  it("yeni veri: dokunma", () => {
    expect(decideArrival({ ...base, fetchedAt: base.nowMs - REVALIDATE_AFTER_MS })).toBe("fresh");
  });
  it("eski önbellek: arka plan tazelemesi", () => {
    expect(decideArrival({ ...base, fetchedAt: base.nowMs - REVALIDATE_AFTER_MS - 1 })).toBe("refresh");
  });
  it("sekme arkada ya da yakın zamanda tazelendi: çift istek yok", () => {
    expect(decideArrival({ ...base, fetchedAt: 0, hidden: true })).toBe("fresh");
    expect(decideArrival({ ...base, fetchedAt: 0, lastBgRefreshAt: base.nowMs - BG_REFRESH_MIN_GAP_MS + 1 })).toBe("fresh");
    expect(decideArrival({ ...base, fetchedAt: 0, lastBgRefreshAt: base.nowMs - BG_REFRESH_MIN_GAP_MS })).toBe("refresh");
  });
});

describe("B010: belge = sabit; iş kuyruğu ve olay geçersizlemesi", () => {
  const base = { nowMs: 1_000_000, lastBgRefreshAt: null, hidden: false };

  it("eşik belgeyle aynı (CLAUDE.md: >20 sn eski sayfa tazelenir); yorum sabitle çelişmez", () => {
    expect(REVALIDATE_AFTER_MS).toBe(20_000);
    expect(readFileSync(resolve(process.cwd(), "CLAUDE.md"), "utf8")).toMatch(/>20 sn eski sayfa sessiz `router\.refresh\(\)` ile tazelenir/);
    const src = readFileSync(resolve(process.cwd(), "src/lib/client-cache-policy.ts"), "utf8");
    expect(src).toMatch(/export const REVALIDATE_AFTER_MS = 20_000;/);
  });

  it("iş kuyruğu rotaları: onaylar, destek, yönetim panosu (tam), destek talepleri (önek)", () => {
    for (const p of ["/app/onaylar", "/app/onaylar?durum=bekliyor", "/app/destek", "/app/destek/abc", "/admin", "/admin/tickets", "/admin/tickets/1"]) {
      expect(isWorkQueuePath(p), p).toBe(true);
    }
    for (const p of ["/admin/tenants", "/app/musteriler", "/app", "/app/onaylarx"]) expect(isWorkQueuePath(p), p).toBe(false);
  });

  it("iş kuyruğunda eşik 0-5 sn; oturumdaki ilk açılış (önceden yüklenmiş olabilir) da tazelenir", () => {
    expect(WORK_QUEUE_REVALIDATE_AFTER_MS).toBeLessThanOrEqual(5_000);
    expect(decideArrival({ ...base, workQueue: true, fetchedAt: base.nowMs - WORK_QUEUE_REVALIDATE_AFTER_MS })).toBe("fresh");
    expect(decideArrival({ ...base, workQueue: true, fetchedAt: base.nowMs - WORK_QUEUE_REVALIDATE_AFTER_MS - 1 })).toBe("refresh");
    expect(decideArrival({ ...base, workQueue: true, fetchedAt: undefined })).toBe("refresh");
    expect(decideArrival({ ...base, workQueue: true, fetchedAt: 0, lastBgRefreshAt: base.nowMs - WORK_QUEUE_BG_REFRESH_MIN_GAP_MS })).toBe("refresh");
  });

  it("sayfa yüklemesinden sonraki ilk varış her zaman yalnız işaretlenir (veri canlı)", () => {
    expect(decideArrival({ ...base, workQueue: true, fetchedAt: undefined, firstArrival: true })).toBe("mark");
  });

  it("realtime olayı / bildirim rotayı geçersizlediyse süre beklenmeden tazelenir", () => {
    const fetchedAt = base.nowMs - 1_000;
    expect(decideArrival({ ...base, fetchedAt, invalidatedAt: base.nowMs - 500 })).toBe("refresh");
    expect(decideArrival({ ...base, fetchedAt, invalidatedAt: base.nowMs - 2_000 })).toBe("fresh");
    expect(decideArrival({ ...base, fetchedAt: undefined, invalidatedAt: base.nowMs - 2_000 })).toBe("refresh");
  });
});

describe("kapı reddi (pasif / askı / giriş) tam yükleme ister", () => {
  it("kapı adresleri", () => {
    expect(isGatePath("/app/askida")).toBe(true);
    expect(isGatePath("/giris/dogrulama")).toBe(true);
    expect(isGatePath("/app/musteriler")).toBe(false);
  });
  it("yalnız arka plan tazelemesinden hemen sonra", () => {
    expect(isGateRedirectAfterRefresh("/app/askida", 1000, 5000)).toBe(true);
    expect(isGateRedirectAfterRefresh("/app/askida", null, 5000)).toBe(false);
    expect(isGateRedirectAfterRefresh("/app/askida", 1000, 1000 + 60_000)).toBe(false);
    expect(isGateRedirectAfterRefresh("/app/musteriler", 1000, 2000)).toBe(false);
  });
});

describe("ağ kapısı", () => {
  it("veri tasarrufu ve 2g/3g'de kapalı", () => {
    expect(networkAllowsPrefetch(undefined)).toBe(true);
    expect(networkAllowsPrefetch({ effectiveType: "4g" })).toBe(true);
    expect(networkAllowsPrefetch({ saveData: true, effectiveType: "4g" })).toBe(false);
    expect(networkAllowsPrefetch({ effectiveType: "3g" })).toBe(false);
    expect(networkAllowsPrefetch({ effectiveType: "slow-2g" })).toBe(false);
  });
});
