import { describe, expect, it } from "vitest";
import {
  advisorAssignmentDecision,
  canAssignOthers,
  checkRentalEdit,
  checkRentalExtension,
  dealLinkDecision,
  normalizeExtendDays,
  paymentLinkCancelDecision,
} from "./workflow-rules";

describe("randevu danışman ataması", () => {
  it("yönetim katmanı başkasını atayabilir, danışman atayamaz", () => {
    expect(canAssignOthers("owner")).toBe(true);
    expect(canAssignOthers("branch_manager")).toBe(true);
    expect(canAssignOthers("team_lead")).toBe(true);
    expect(canAssignOthers("advisor")).toBe(false);
    expect(canAssignOthers("readonly")).toBe(false);
  });
  it("boş veya kendisi ise serbest", () => {
    expect(advisorAssignmentDecision("advisor", "", "u1")).toEqual({ kind: "self", advisorId: "u1" });
    expect(advisorAssignmentDecision("advisor", "u1", "u1")).toEqual({ kind: "self", advisorId: "u1" });
  });
  it("başkası: yetkiliye izin, yetkisize ret", () => {
    expect(advisorAssignmentDecision("gm", "u2", "u1")).toEqual({ kind: "other", advisorId: "u2" });
    expect(advisorAssignmentDecision("advisor", "u2", "u1")).toEqual({ kind: "denied" });
  });
});

describe("ödeme linki iptal", () => {
  it("karar tablosu", () => {
    expect(paymentLinkCancelDecision("open", false)).toBe("cancel");
    expect(paymentLinkCancelDecision("open", true)).toBe("captured");
    expect(paymentLinkCancelDecision("paid", false)).toBe("not_open");
    expect(paymentLinkCancelDecision("expired", false)).toBe("not_open");
    expect(paymentLinkCancelDecision("cancelled", false)).toBe("already_cancelled");
  });
  it("uzatma gün sayısı 1-30", () => {
    expect(normalizeExtendDays(7)).toBe(7);
    expect(normalizeExtendDays("30")).toBe(30);
    expect(normalizeExtendDays(0)).toBeNull();
    expect(normalizeExtendDays(31)).toBeNull();
    expect(normalizeExtendDays("abc")).toBeNull();
  });
});

describe("kira uzatma ve düzenleme", () => {
  const base = { status: "active", startDate: "2026-01-01", currentEnd: "2026-12-31" };
  it("mevcut bitişten sonrası kabul", () => {
    expect(checkRentalExtension({ ...base, newEnd: "2027-12-31" })).toEqual({ ok: true });
  });
  it("mevcut bitişe eşit veya öncesi ret", () => {
    expect(checkRentalExtension({ ...base, newEnd: "2026-12-31" }).ok).toBe(false);
    expect(checkRentalExtension({ ...base, newEnd: "2026-06-01" }).ok).toBe(false);
  });
  it("süresiz yapma ve zaten süresiz", () => {
    expect(checkRentalExtension({ ...base, newEnd: null })).toEqual({ ok: true });
    expect(checkRentalExtension({ ...base, currentEnd: null, newEnd: null })).toEqual({ ok: true, noop: true });
  });
  it("sonlanmış kira uzatılamaz", () => {
    expect(checkRentalExtension({ ...base, status: "ended", newEnd: "2028-01-01" }).ok).toBe(false);
  });
  it("düzenleme: vade günü ve bitiş", () => {
    expect(checkRentalEdit({ dueDay: 15, startDate: "2026-01-01", endDate: null }).ok).toBe(true);
    expect(checkRentalEdit({ dueDay: 0, startDate: "2026-01-01", endDate: null }).ok).toBe(false);
    expect(checkRentalEdit({ dueDay: 29, startDate: "2026-01-01", endDate: null }).ok).toBe(false);
    expect(checkRentalEdit({ dueDay: 5, startDate: "2026-01-01", endDate: "2026-01-01" }).ok).toBe(false);
  });
});

describe("anlaşma bağlama", () => {
  const current = { propertyId: null, customerId: "c1" };
  it("kazanılmış anlaşma kilitli", () => {
    expect(dealLinkDecision({ stage: "won", current, next: { propertyId: "p1" } })).toBe("locked");
  });
  it("portföy eklenince güncelle, aynı değerde işlem yok", () => {
    expect(dealLinkDecision({ stage: "negotiation", current, next: { propertyId: "p1" } })).toBe("update");
    expect(dealLinkDecision({ stage: "negotiation", current, next: { customerId: "c1" } })).toBe("noop");
    expect(dealLinkDecision({ stage: "new", current, next: {} })).toBe("noop");
  });
  it("bağı kaldırma da değişikliktir", () => {
    expect(dealLinkDecision({ stage: "new", current, next: { customerId: null } })).toBe("update");
  });
});
