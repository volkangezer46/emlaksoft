import { describe, expect, it } from "vitest";
import { deviceLabel, summarizeDevices, type LoginEventRow } from "@/lib/account/device-label";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1";

const ev = (id: string, ua: string | null, result: string, at: string, ip: string | null = null): LoginEventRow => ({
  id, ip, user_agent: ua, result, created_at: at,
});

describe("deviceLabel", () => {
  it("işletim sistemi ve tarayıcıyı çıkarır", () => {
    expect(deviceLabel(CHROME_WIN)).toBe("Windows · Chrome");
    expect(deviceLabel(SAFARI_IOS)).toBe("iOS · Safari");
    expect(deviceLabel(null)).toBe("Bilinmiyor");
  });
});

describe("summarizeDevices", () => {
  it("yalnız başarılı girişleri cihaza göre gruplar, en yeni önce", () => {
    const rows = [
      ev("1", CHROME_WIN, "success", "2026-10-01T10:00:00Z", "1.1.1.1"),
      ev("2", CHROME_WIN, "failed", "2026-10-03T10:00:00Z"),
      ev("3", SAFARI_IOS, "success", "2026-10-02T10:00:00Z", "2.2.2.2"),
      ev("4", CHROME_WIN, "success", "2026-09-30T10:00:00Z", "3.3.3.3"),
    ];
    const out = summarizeDevices(rows);
    expect(out.map((d) => d.label)).toEqual(["iOS · Safari", "Windows · Chrome"]);
    expect(out[1]).toMatchObject({ successCount: 2, lastIp: "1.1.1.1", lastSeenAt: "2026-10-01T10:00:00Z" });
  });
  it("boş girdi boş döner", () => {
    expect(summarizeDevices([])).toEqual([]);
  });
});
