import { describe, expect, it } from "vitest";
import {
  dailyUptime,
  formatDuration,
  formatUptime,
  isMissingTableError,
  maintenanceActive,
  maintenanceOverdue,
  overallStatus,
  overallUptime,
  parseIstanbulLocal,
  statusReadable,
  toIstanbulLocal,
  type PublicIncident,
} from "./model";

const NOW = Date.parse("2026-10-14T09:00:00Z"); // 12:00 İstanbul
const SINCE = "2026-10-13T18:24:00Z";

describe("dailyUptime", () => {
  it("ölçüm öncesi günler 'ölçüm yok', sonrası ölçülen süreyle hesaplanır", () => {
    const days = dailyUptime([], NOW, 3, SINCE);
    expect(days.map((d) => d.day)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(days[0]).toMatchObject({ pct: null, level: "none", coveredSec: 0 });
    // 13 Ekim: 21:24 İstanbul → gece yarısı = 2 sa 36 dk
    expect(days[1].coveredSec).toBe(156 * 60);
    expect(days[1].level).toBe("ok");
    // 14 Ekim: 00:00 → 12:00 İstanbul
    expect(days[2].coveredSec).toBe(12 * 3600);
  });

  it("kesinti gün sınırında bölünür; açık kesinti şimdiye kadar sayılır", () => {
    const days = dailyUptime(
      [
        { start: "2026-10-13T20:50:00Z", end: "2026-10-13T21:10:00Z" }, // 23:50 → 00:10 İstanbul
        { start: "2026-10-14T08:30:00Z", end: null }, // açık: 30 dk
      ],
      NOW,
      2,
      SINCE,
    );
    expect(days[0].downSec).toBe(10 * 60);
    expect(days[0].level).toBe("minor");
    expect(days[1].downSec).toBe(40 * 60);
    expect(days[1].level).toBe("major");
    const total = overallUptime(days)!;
    expect(total).toBeCloseTo(((156 * 60 + 12 * 3600 - 50 * 60) / (156 * 60 + 12 * 3600)) * 100, 6);
  });

  it("hiç ölçüm yoksa genel yüzde null", () => {
    expect(overallUptime(dailyUptime([], Date.parse("2026-10-01T00:00:00Z"), 5, SINCE))).toBeNull();
  });
});

describe("biçimleme", () => {
  it("yüzde aşağı yuvarlanır (kesinti %100 görünmez)", () => {
    expect(formatUptime(100)).toBe("%100");
    expect(formatUptime(99.9999)).toBe("%99,99");
    expect(formatUptime(null)).toBe("Ölçüm yok");
  });
  it("süre", () => {
    expect(formatDuration(42)).toBe("42 sn");
    expect(formatDuration(600)).toBe("10 dk");
    expect(formatDuration(3900)).toBe("1 sa 5 dk");
    expect(formatDuration(7200)).toBe("2 sa");
  });
  it("İstanbul yerel saat dönüşümü", () => {
    expect(parseIstanbulLocal("2026-10-14T12:00")).toBe("2026-10-14T09:00:00.000Z");
    expect(parseIstanbulLocal("2026-02-30T12:00")).toBeNull();
    expect(parseIstanbulLocal("bozuk")).toBeNull();
    expect(toIstanbulLocal("2026-10-14T09:00:00.000Z")).toBe("2026-10-14T12:00");
    expect(toIstanbulLocal(null)).toBe("");
  });
});

const inc = (p: Partial<PublicIncident>): PublicIncident => ({
  id: "x",
  kind: "incident",
  title: "t",
  impact: "minor",
  status: "investigating",
  startedAt: "2026-10-14T08:00:00Z",
  resolvedAt: null,
  scheduledStart: null,
  scheduledEnd: null,
  updates: [],
  ...p,
});

describe("overallStatus", () => {
  it("okunamazsa unknown (sahte yeşil yok)", () => {
    expect(overallStatus({ incidents: [], outageOpen: false, nowMs: NOW, readable: false })).toBe("unknown");
  });
  it("en ağır açık olay kazanır", () => {
    expect(overallStatus({ incidents: [inc({ impact: "minor" }), inc({ impact: "critical" })], outageOpen: false, nowMs: NOW, readable: true })).toBe("major");
    expect(overallStatus({ incidents: [inc({ impact: "major" })], outageOpen: false, nowMs: NOW, readable: true })).toBe("partial");
    expect(overallStatus({ incidents: [inc({})], outageOpen: false, nowMs: NOW, readable: true })).toBe("degraded");
    expect(overallStatus({ incidents: [inc({ status: "resolved", resolvedAt: "2026-10-14T08:30:00Z" })], outageOpen: false, nowMs: NOW, readable: true })).toBe("operational");
  });
  it("ölçülen açık kesinti olay girilmeden de görünür", () => {
    expect(overallStatus({ incidents: [], outageOpen: true, nowMs: NOW, readable: true })).toBe("partial");
  });
  it("planlı bakım penceresi", () => {
    const m = inc({ kind: "maintenance", status: "scheduled", scheduledStart: "2026-10-14T08:00:00Z", scheduledEnd: "2026-10-14T10:00:00Z" });
    expect(maintenanceActive(m, NOW)).toBe(true);
    expect(maintenanceActive(m, Date.parse("2026-10-14T11:00:00Z"))).toBe(false);
    expect(overallStatus({ incidents: [m], outageOpen: false, nowMs: NOW, readable: true })).toBe("maintenance");
    expect(maintenanceActive({ ...m, status: "completed" }, NOW)).toBe(false);
  });
});

describe("maintenanceOverdue", () => {
  const m = inc({ kind: "maintenance", status: "scheduled", scheduledStart: "2026-10-14T08:00:00Z", scheduledEnd: "2026-10-14T10:00:00Z" });
  it("pencere geçmiş ve hâlâ Planlandı → kapatılmayı bekliyor", () => {
    expect(maintenanceOverdue(m, Date.parse("2026-10-14T11:00:00Z"))).toBe(true);
    expect(maintenanceOverdue(m, NOW)).toBe(false);
  });
  it("sürüyor/tamamlandı ya da olay türü ise değil", () => {
    const later = Date.parse("2026-10-14T11:00:00Z");
    expect(maintenanceOverdue({ ...m, status: "in_progress" }, later)).toBe(false);
    expect(maintenanceOverdue({ ...m, status: "completed" }, later)).toBe(false);
    expect(maintenanceOverdue(inc({ scheduledEnd: "2026-10-14T10:00:00Z" }), later)).toBe(false);
  });
});

describe("statusReadable", () => {
  const boom = { code: "57014", message: "timeout" };
  it("ölçüm hatası → okunamaz", () => {
    expect(statusReadable({ outage: boom, incidents: [] })).toBe(false);
  });
  it("olay okuması tablo eksikliği dışında düşerse okunamaz (açık kritik olay sessizce kaybolmasın)", () => {
    expect(statusReadable({ outage: null, incidents: [null, boom, null] })).toBe(false);
    expect(overallStatus({ incidents: [], outageOpen: false, nowMs: NOW, readable: statusReadable({ outage: null, incidents: [boom] }) })).toBe("unknown");
  });
  it("tablo yok (kurulum bekliyor) okunamama sayılmaz", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(statusReadable({ outage: null, incidents: [{ code: "42P01" }, { code: "PGRST205" }, null] })).toBe(true);
  });
});
