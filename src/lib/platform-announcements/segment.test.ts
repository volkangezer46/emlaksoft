import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { buildDeliveryRows, trackingPath } from "./queue";
import { describeSegment, parseSegment, segmentFromForm, tenantMatchesSegment, type SegmentTenant } from "./segment";

const NOW = Date.UTC(2026, 9, 13, 7, 0, 0); // 10:00 TSİ
const T = (over: Partial<SegmentTenant>): SegmentTenant => ({ id: "t", plan: "office", status: "active", trial_ends_at: null, city: null, ...over });

function form(entries: [string, string][]) {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe("segment ayrıştırma", () => {
  it("'Denemesi 3 gün içinde bitecek ofis sahipleri' formdan doğru segmente döner", () => {
    const r = segmentFromForm(form([["seg_status", "trial"], ["seg_trial_days", "3"], ["seg_owners", "on"]]));
    expect(r).toEqual({ ok: true, value: { statuses: ["trial"], trialEndsWithinDays: 3, ownersOnly: true } });
    if (r.ok) expect(describeSegment(r.value)).toBe("Deneme · Deneme bitişine ≤3 gün · yalnız sahipler");
  });

  it("boş form = tüm ofisler; bilinmeyen plan/durum ve kullanıcıya ofissiz mesaj reddedilir", () => {
    expect(segmentFromForm(new FormData())).toEqual({ ok: true, value: {} });
    expect(segmentFromForm(form([["seg_plan", "gold"]])).ok).toBe(false);
    expect(segmentFromForm(form([["seg_status", "cancelled"]])).ok).toBe(false);
    expect(segmentFromForm(form([["seg_user", "11111111-1111-4111-8111-111111111111"]])).ok).toBe(false);
    expect(parseSegment({ hack: true }).ok).toBe(false);
  });

  it("son giriş ve modül ölçütleri ancak tam girilince eklenir", () => {
    const r = segmentFromForm(form([["seg_login_mode", "inactive"], ["seg_module", "campaigns"], ["seg_module_state", "off"], ["seg_city", "İstanbul, Ankara"]]));
    expect(r).toEqual({ ok: true, value: { module: { key: "campaigns", enabled: false }, cities: ["İstanbul", "Ankara"] } });
    expect(segmentFromForm(form([["seg_module", "yok_boyle_modul"]])).ok).toBe(false);
  });
});

describe("tenantMatchesSegment (saf)", () => {
  const seg = { statuses: ["trial" as const], trialEndsWithinDays: 3 };
  it("deneme bitişi: geçmiş ya da 3 günden uzak olan dışarıda", () => {
    expect(tenantMatchesSegment(T({ status: "trial", trial_ends_at: new Date(NOW + 2 * DAY_MS).toISOString() }), seg, { nowMs: NOW })).toBe(true);
    expect(tenantMatchesSegment(T({ status: "trial", trial_ends_at: new Date(NOW + 4 * DAY_MS).toISOString() }), seg, { nowMs: NOW })).toBe(false);
    expect(tenantMatchesSegment(T({ status: "trial", trial_ends_at: new Date(NOW - 1000).toISOString() }), seg, { nowMs: NOW })).toBe(false);
    expect(tenantMatchesSegment(T({ status: "active", trial_ends_at: new Date(NOW + DAY_MS).toISOString() }), { trialEndsWithinDays: 3 }, { nowMs: NOW })).toBe(false);
  });

  it("iptal edilmiş ofis hiçbir segmentte yok; il büyük/küçük harf duyarsız", () => {
    expect(tenantMatchesSegment(T({ status: "cancelled" }), {}, { nowMs: NOW })).toBe(false);
    expect(tenantMatchesSegment(T({ city: "İSTANBUL" }), { cities: ["istanbul"] }, { nowMs: NOW })).toBe(true);
    expect(tenantMatchesSegment(T({ city: null }), { cities: ["Ankara"] }, { nowMs: NOW })).toBe(false);
  });

  it("son giriş ve modül kümeleri", () => {
    const ctx = { nowMs: NOW, loggedInTenantIds: new Set(["a"]), moduleClosedTenantIds: new Set(["b"]) };
    expect(tenantMatchesSegment(T({ id: "a" }), { lastLogin: { mode: "active", days: 7 } }, ctx)).toBe(true);
    expect(tenantMatchesSegment(T({ id: "b" }), { lastLogin: { mode: "active", days: 7 } }, ctx)).toBe(false);
    expect(tenantMatchesSegment(T({ id: "b" }), { lastLogin: { mode: "inactive", days: 7 } }, ctx)).toBe(true);
    expect(tenantMatchesSegment(T({ id: "b" }), { module: { key: "campaigns", enabled: false } }, ctx)).toBe(true);
    expect(tenantMatchesSegment(T({ id: "a" }), { module: { key: "campaigns", enabled: false } }, ctx)).toBe(false);
  });
});

describe("teslim satırları (saf)", () => {
  const recipients = [
    { tenantId: "t1", userId: "u1", marketingOptIn: true },
    { tenantId: "t2", userId: "u2", marketingOptIn: false },
  ];
  it("alıcı x kanal; bilinmeyen kanal yok sayılır", () => {
    const rows = buildDeliveryRows("a", ["email", "in_app", "sms"], false, recipients);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });
  it("ticari ileti: pazarlama izni olmayan alıcı 'skipped' (İYS) yazılır, gönderilmez", () => {
    const rows = buildDeliveryRows("a", ["in_app"], true, recipients);
    expect(rows.find((r) => r.user_id === "u1")?.status).toBe("pending");
    expect(rows.find((r) => r.user_id === "u2")).toMatchObject({ status: "skipped", error: "Ticari ileti izni yok (İYS)" });
  });
  it("tıklama bağlantısı yalnız teslim kimliği taşır (hedef adres istekte yok)", () => {
    expect(trackingPath("abc")).toBe("/api/duyuru/tik?d=abc");
  });
});
