import { describe, expect, it } from "vitest";
import {
  DEAL_PROCESS_STEPS,
  buildDealProcess,
  isDealProcessKey,
  isMissingDealProcessTable,
  parseDealProcessInput,
  toPortalSteps,
  type DealProcessRow,
} from "./deal-process";

const NOW = Date.parse("2026-10-08T09:00:00Z");
const row = (stepKey: string, extra: Partial<DealProcessRow> = {}): DealProcessRow => ({
  stepKey,
  doneAt: null,
  plannedAt: null,
  assignedTo: null,
  note: null,
  ...extra,
});

describe("buildDealProcess", () => {
  it("satır yokken sekiz adım var, ilk adım 'current', yüzde 0", () => {
    const v = buildDealProcess([], NOW);
    expect(v.total).toBe(8);
    expect(v.percent).toBe(0);
    expect(v.currentKey).toBe("offer_accepted");
    expect(v.steps.map((s) => s.status)).toEqual(["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });

  it("tamamlanan adımlar yüzdeyi ve sıradaki adımı belirler", () => {
    const v = buildDealProcess([row("offer_accepted", { doneAt: "2026-10-01T10:00:00Z" }), row("deposit", { doneAt: "2026-10-02T10:00:00Z" })], NOW);
    expect(v.doneCount).toBe(2);
    expect(v.percent).toBe(25);
    expect(v.currentKey).toBe("appraisal_credit");
    expect(v.complete).toBe(false);
  });

  it("planlanan tarihi geçmiş yapılmamış adım 'overdue' olur ve sayılır", () => {
    const v = buildDealProcess([row("offer_accepted", { doneAt: "2026-10-01T10:00:00Z" }), row("deposit", { plannedAt: "2026-10-05T10:00:00Z" })], NOW);
    expect(v.steps[1]!.status).toBe("overdue");
    expect(v.overdueCount).toBe(1);
    // gecikmiş adımdan sonraki ilk adım 'current' DEĞİL (sıra gecikende)
    expect(v.steps[2]!.status).toBe("upcoming");
  });

  it("TKGM planlanan tarihi boşsa anlaşmadaki tapu randevusu yedek olur; adımdaki tarih önceliklidir", () => {
    const fallback = buildDealProcess([], NOW, "2026-10-20T08:00:00Z");
    expect(fallback.steps.find((s) => s.key === "tkgm_appointment")!.plannedAt).toBe("2026-10-20T08:00:00Z");
    const own = buildDealProcess([row("tkgm_appointment", { plannedAt: "2026-10-25T08:00:00Z" })], NOW, "2026-10-20T08:00:00Z");
    expect(own.steps.find((s) => s.key === "tkgm_appointment")!.plannedAt).toBe("2026-10-25T08:00:00Z");
  });

  it("bütün adımlar bitince %100 ve complete", () => {
    const rows = DEAL_PROCESS_STEPS.map((s) => row(s.key, { doneAt: "2026-10-01T10:00:00Z" }));
    const v = buildDealProcess(rows, NOW);
    expect(v.percent).toBe(100);
    expect(v.complete).toBe(true);
    expect(v.currentKey).toBeNull();
  });

  it("bilinmeyen adım anahtarı yok sayılır", () => {
    const v = buildDealProcess([row("uydurma", { doneAt: "2026-10-01T10:00:00Z" })], NOW);
    expect(v.doneCount).toBe(0);
  });
});

describe("toPortalSteps (KVKK)", () => {
  it("not ve sorumlu portala gitmez; gecikmiş adım 'current' görünür", () => {
    const v = buildDealProcess(
      [row("offer_accepted", { doneAt: "2026-10-01T10:00:00Z", note: "İÇ NOT", assignedTo: "11111111-1111-1111-1111-111111111111" }), row("deposit", { plannedAt: "2026-10-05T10:00:00Z", note: "gizli" })],
      NOW,
    );
    const p = toPortalSteps(v);
    const json = JSON.stringify(p);
    expect(json).not.toContain("İÇ NOT");
    expect(json).not.toContain("gizli");
    expect(json).not.toContain("11111111");
    expect(p.steps[1]!.status).toBe("current");
  });
});

describe("parseDealProcessInput", () => {
  it("geçerli girdi", () => {
    const r = parseDealProcessInput({ plannedAt: "2026-10-20T08:00:00Z", assignedTo: "", note: "  not  ", done: "on" });
    expect(r).toEqual({ ok: true, value: { plannedAt: "2026-10-20T08:00:00.000Z", assignedTo: null, note: "not", done: true } });
  });
  it("uzun not, bozuk sorumlu ve bozuk tarih reddedilir", () => {
    expect(parseDealProcessInput({ note: "x".repeat(501) }).ok).toBe(false);
    expect(parseDealProcessInput({ assignedTo: "abc" }).ok).toBe(false);
    expect(parseDealProcessInput({ plannedAt: "yarın" }).ok).toBe(false);
    expect(parseDealProcessInput({ plannedAt: "1999-01-01T00:00:00Z" }).ok).toBe(false);
  });
  it("anahtar ve eksik tablo tespiti", () => {
    expect(isDealProcessKey("dask")).toBe(true);
    expect(isDealProcessKey("x")).toBe(false);
    expect(isMissingDealProcessTable({ code: "42P01" })).toBe(true);
    expect(isMissingDealProcessTable({ code: "23505", message: "boom" })).toBe(false);
  });
});
