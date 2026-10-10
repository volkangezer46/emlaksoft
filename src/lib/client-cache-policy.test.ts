import { describe, expect, it } from "vitest";
import {
  BG_REFRESH_MIN_GAP_MS,
  decideArrival,
  isGatePath,
  isGateRedirectAfterRefresh,
  networkAllowsPrefetch,
  REVALIDATE_AFTER_MS,
} from "@/lib/client-cache-policy";

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
