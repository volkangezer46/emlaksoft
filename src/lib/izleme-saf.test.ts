import { describe, expect, it } from "vitest";
import { maskPii, sanitizeLogText, shortTenantId } from "@/lib/pii-mask";
import { buildServerErrorEntry } from "@/lib/server-error-report";
import { buildLogLine } from "@/lib/log";
import { evaluateCronHealth } from "@/lib/cron-staleness";
import { computeRefreshDelay, tablesForPath } from "@/lib/realtime-throttle";

describe("maskPii", () => {
  it("e-posta, telefon, TC ve IBAN maskeler", () => {
    const out = maskPii(
      "ali@ornek.com 0532 123 45 67 +905321234567 10000000146 TR33 0006 1005 1978 6457 8413 26 hata",
    );
    expect(out).not.toMatch(/ali@ornek/);
    expect(out).not.toMatch(/0532/);
    expect(out).not.toMatch(/10000000146/);
    expect(out).not.toMatch(/TR33/);
    expect(out).toContain("[E_POSTA]");
    expect(out).toContain("[IBAN]");
    expect(out).toContain("hata");
  });

  it("maskeleyip sonra kırpar", () => {
    const text = `${"x".repeat(490)} ali@ornek.com`;
    const out = sanitizeLogText(text, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).not.toContain("ali@");
  });

  it("kısa tenant id", () => {
    expect(shortTenantId("12345678-aaaa-bbbb-cccc-1234567890ab")).toBe("12345678");
    expect(shortTenantId(null)).toBeNull();
  });
});

describe("buildServerErrorEntry", () => {
  it("PII maskeler, sorgu dizesini atar, digest taşır", () => {
    const err = Object.assign(new Error("duplicate key ali@ornek.com"), { digest: "abc123" });
    const e = buildServerErrorEntry(err, "/app/musteriler?q=0532 123 45 67");
    expect(e?.message).not.toContain("ali@");
    expect(e?.path).toBe("/app/musteriler");
    expect(e?.digest).toBe("abc123");
  });
  it("boş hata null döner", () => {
    expect(buildServerErrorEntry(null, "/")).toBeNull();
  });
});

describe("buildLogLine", () => {
  it("JSON, maskeli, kısa tenant", () => {
    const line = buildLogLine("error", "olay", {
      route: "/api/x",
      digest: "d1",
      tenantId: "12345678-aaaa-bbbb-cccc-1234567890ab",
      detail: "mail ali@ornek.com",
    });
    const o = JSON.parse(line);
    expect(o.tenant).toBe("12345678");
    expect(o.detail).not.toContain("ali@");
    expect(o.level).toBe("error");
  });
});

describe("evaluateCronHealth", () => {
  const jobs = [
    { job: "a", staleAfterMinutes: 60 },
    { job: "b", staleAfterMinutes: 60 },
    { job: "c", staleAfterMinutes: 60 },
  ];
  const nowMs = Date.parse("2026-01-01T12:00:00Z");
  const ago = (m: number) => new Date(nowMs - m * 60_000).toISOString();

  it("taze ve ok olan sorunsuz", () => {
    const rows = jobs.map((j) => ({ job: j.job, last_run_at: ago(10), last_status: "ok" }));
    expect(evaluateCronHealth(rows, nowMs, jobs)).toEqual([]);
  });
  it("bayat, hiç çalışmamış ve hatalı işi bulur", () => {
    const rows = [
      { job: "a", last_run_at: ago(61), last_status: "ok" },
      { job: "b", last_run_at: ago(5), last_status: "error" },
    ];
    const p = evaluateCronHealth(rows, nowMs, jobs);
    expect(p.map((x) => [x.job, x.reason])).toEqual([
      ["a", "stale"],
      ["b", "error"],
      ["c", "never_ran"],
    ]);
  });
  it("pencere sınırında bayat sayılmaz", () => {
    const rows = jobs.map((j) => ({ job: j.job, last_run_at: ago(60), last_status: "ok" }));
    expect(evaluateCronHealth(rows, nowMs, jobs)).toEqual([]);
  });
});

describe("realtime throttle", () => {
  it("ilk olay yalnız debounce bekler", () => {
    expect(computeRefreshDelay(1_000, null, 1_200)).toBe(1_200);
  });
  it("yakın zamanda yenilendiyse 10 sn dolana kadar bekler", () => {
    expect(computeRefreshDelay(103_000, 100_000, 1_200)).toBe(7_000);
  });
  it("10 sn geçtiyse yalnız debounce", () => {
    expect(computeRefreshDelay(115_000, 100_000, 1_200)).toBe(1_200);
  });
  it("rota duyarlı tablo alt kümesi", () => {
    expect(tablesForPath("/app/musteriler")).toEqual(["customers"]);
    expect(tablesForPath("/app/musteriler/abc")).toEqual(["customers"]);
    expect(tablesForPath("/app/komisyon")).toEqual(["commissions"]);
    expect(tablesForPath("/app")).toHaveLength(4);
    expect(tablesForPath("/app/musteriler-x")).toEqual([]);
    expect(tablesForPath("/app/ayarlar")).toEqual([]);
  });
});
