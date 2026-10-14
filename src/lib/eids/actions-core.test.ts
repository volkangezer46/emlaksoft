import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EIDS_LEGAL_NOTE,
  addBusinessDaysMs,
  canCloseTakedown,
  computeComplianceReport,
  decideForEvent,
  EIDS_ACTIONABLE_EVENT_KINDS,
  forwardingState,
  maskSampleForAdmin,
  ownerConfirmRequestText,
  planTakedownItems,
  publishDedupeKey,
  shouldEscalate,
  takedownDedupeKey,
  takedownTaskText,
  trIsoWeekKey,
  type AuthorityEventInput,
} from "@/lib/eids/actions-core";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 2026-10-16 Cuma 15:00 TR (12:00 UTC)
const FRI = Date.UTC(2026, 9, 16, 12, 0, 0);
const ev = (over: Partial<AuthorityEventInput> = {}): AuthorityEventInput => ({ id: "e1", tenant_id: "t1", property_id: "p1", kind: "grant", ...over });

describe("olay → karar", () => {
  it("verme yayın görevi/bilgi notu, uzatma yenileme kapatma, iptal kaldırma", () => {
    expect(decideForEvent(ev()).action).toBe("publish_or_note");
    expect(decideForEvent(ev({ kind: "extend" })).action).toBe("extend");
    expect(decideForEvent(ev({ kind: "revoke" }))).toEqual({ action: "takedown", cause: { kind: "revoke", eventId: "e1" } });
  });
  it("süre bitimi bitiş tarihiyle anahtarlanır (cron ve olay aynı görevi bulur)", () => {
    const d = decideForEvent(ev({ kind: "expire", valid_until: "2026-10-10" }));
    expect(d).toEqual({ action: "takedown", cause: { kind: "expire", endDate: "2026-10-10" } });
    if (d.action === "takedown") expect(takedownDedupeKey("p1", d.cause)).toBe("eids:takedown:p1:expire:2026-10-10");
  });
  it("eşleşmemiş olay işlenmez; geri alma kaldırmayı geri çevirir", () => {
    expect(decideForEvent(ev({ property_id: null })).action).toBe("none");
    expect(decideForEvent(ev({ kind: "undo", prev_status: "revoked", new_status: "approved" })).action).toBe("undo_takedown");
    expect(decideForEvent(ev({ kind: "manual_set", prev_status: "approved", new_status: "revoked" })).action).toBe("takedown");
    expect(decideForEvent(ev({ kind: "undo", prev_status: "pending", new_status: "approved" })).action).toBe("none");
  });
  it("Eşleştir kuyruğundan bağlama (link) durum geçişiyle karar verir; cron süzgeci link/override'ı kapsar", () => {
    expect(decideForEvent(ev({ id: "e7", kind: "link", prev_status: "approved", new_status: "revoked" }))).toEqual({
      action: "takedown",
      cause: { kind: "revoke", eventId: "e7" },
    });
    expect(decideForEvent(ev({ kind: "link", prev_status: "unknown", new_status: "revoked" })).action).toBe("takedown");
    expect(decideForEvent(ev({ kind: "link", prev_status: "unknown", new_status: "approved" })).action).toBe("publish_or_note");
    expect(decideForEvent(ev({ kind: "link", prev_status: "revoked", new_status: "approved" })).action).toBe("undo_takedown");
    expect(decideForEvent(ev({ kind: "override", prev_status: "approved", new_status: "approved" })).action).toBe("none");
    expect(decideForEvent(ev({ kind: "link", property_id: null, new_status: "revoked" })).action).toBe("none");
    expect([...EIDS_ACTIONABLE_EVENT_KINDS]).toEqual(expect.arrayContaining(["link", "override", "undo", "manual_set"]));
  });
  it("aynı olay aynı anahtarı üretir (ikinci görev açılmaz)", () => {
    const c = { kind: "revoke" as const, eventId: "e9" };
    expect(takedownDedupeKey("p1", c)).toBe(takedownDedupeKey("p1", c));
    expect(publishDedupeKey("p1", "2027-01-31", "e1")).toBe("eids:publish:p1:2027-01-31");
    expect(publishDedupeKey("p1", null, "e1")).toBe("eids:publish:p1:e1");
  });
});

describe("tarih", () => {
  it("2 iş günü: Cuma → Salı 18:00 TR; hafta içi → +2 gün", () => {
    expect(new Date(addBusinessDaysMs(FRI, 2)).toISOString()).toBe("2026-10-20T15:00:00.000Z");
    const mon = FRI + 3 * DAY; // Pazartesi
    expect(new Date(addBusinessDaysMs(mon, 2)).toISOString()).toBe("2026-10-21T15:00:00.000Z");
  });
  it("48 saat yükseltme: bir kez, yalnız açık görev", () => {
    const created = new Date(FRI - 49 * HOUR).toISOString();
    expect(shouldEscalate({ status: "open", created_at: created, escalated_at: null }, FRI)).toBe(true);
    expect(shouldEscalate({ status: "open", created_at: created, escalated_at: created }, FRI)).toBe(false);
    expect(shouldEscalate({ status: "done", created_at: created, escalated_at: null }, FRI)).toBe(false);
    expect(shouldEscalate({ status: "open", created_at: new Date(FRI - 47 * HOUR).toISOString(), escalated_at: null }, FRI)).toBe(false);
    expect(shouldEscalate({ status: "open", created_at: new Date(FRI - 25 * HOUR).toISOString(), escalated_at: null }, FRI, 24)).toBe(true);
  });
  it("ISO hafta anahtarı", () => {
    expect(trIsoWeekKey(FRI)).toBe("2026-W42");
  });
});

describe("kontrol listesi", () => {
  const live = [
    { id: "l1", portal_name: "Sahibinden " },
    { id: "l2", portal_name: "hepsiemlak" },
    { id: "l3", portal_name: "zingat" },
  ];
  it("yalnız AKTİF üyelikli portallar + vitrin, paylaşım, sosyal", () => {
    const items = planTakedownItems({ liveListings: live, activePortals: new Set(["sahibinden", "hepsiemlak"]) });
    expect(items.map((i) => i.target)).toEqual(["hepsiemlak", "sahibinden", "vitrin", "paylasim", "sosyal"]);
    expect(items.find((i) => i.target === "sahibinden")?.portal_listing_id).toBe("l1");
  });
  it("üyelik bilgisi yoksa (EP1 kurulmamış) tüm canlı kayıtlar girer", () => {
    expect(planTakedownItems({ liveListings: live, activePortals: null }).filter((i) => i.portal_listing_id).length).toBe(3);
  });
  it("kalemler işaretlenmeden görev kapanmaz", () => {
    expect(canCloseTakedown([{ status: "removed" }, { status: "pending" }])).toBe(false);
    expect(canCloseTakedown([{ status: "removed" }, { status: "not_found" }])).toBe(true);
    expect(canCloseTakedown([])).toBe(false);
  });
});

describe("metinler", () => {
  it("kaldırma görevi md. 14/2-h, 14/2-j ve ceza aralığını yazar", () => {
    const t = takedownTaskText({ label: "P-1 Kadıköy", cause: { kind: "revoke", eventId: "e" } });
    expect(t.title.startsWith("ACİL")).toBe(true);
    expect(t.notes).toContain("14/2-h");
    expect(t.notes).toContain("14/2-j");
    expect(t.notes).toContain("28.620 – 858.620 TL");
    expect(EIDS_LEGAL_NOTE).toContain("858.620");
    expect(takedownTaskText({ label: "x", cause: { kind: "expire", endDate: "2026-10-10" } }).notes).toContain("10.10.2026");
  });
  it("malikten teyit metni e-Devlet ekran görüntüsü ister, 460 karakteri aşmaz", () => {
    const t = ownerConfirmRequestText({ ownerName: "Ayşe", office: "Demo Emlak", propertyLabel: "P-1", eidsNo: "123456789" });
    expect(t).toContain("ekran görüntüsü");
    expect(t).toContain("EİDS Yetki İşlemleri");
    expect(t).toContain("123456789");
    expect(ownerConfirmRequestText({ propertyLabel: "x".repeat(900) }).length).toBeLessThanOrEqual(460);
  });
});

describe("iletme durumu ve uyum raporu", () => {
  it("bağlı / sessiz / kurulmadı", () => {
    expect(forwardingState(null, FRI)).toBe("kurulmadi");
    expect(forwardingState({ created_at: new Date(FRI - 200 * DAY).toISOString(), last_received_at: new Date(FRI - 10 * DAY).toISOString() }, FRI)).toBe("bagli");
    expect(forwardingState({ created_at: new Date(FRI - 200 * DAY).toISOString(), last_received_at: null }, FRI)).toBe("sessiz");
    expect(forwardingState({ created_at: new Date(FRI - 5 * DAY).toISOString(), last_received_at: null }, FRI)).toBe("bagli");
  });
  it("ortalama kaldırma süresi, 3 günü aşanlar, oranlar ve puan", () => {
    const r = computeComplianceReport({
      nowMs: FRI,
      tasks: [
        { id: "a", created_at: new Date(FRI - 10 * DAY).toISOString(), completed_at: new Date(FRI - 9 * DAY).toISOString(), status: "done", assigned_to: null },
        { id: "b", created_at: new Date(FRI - 10 * DAY).toISOString(), completed_at: new Date(FRI - 5 * DAY).toISOString(), status: "done", assigned_to: null },
        { id: "c", created_at: new Date(FRI - 4 * DAY).toISOString(), completed_at: null, status: "open", assigned_to: null },
      ],
      portfolio: { total: 10, emailVerified: 4, unknown: 2 },
    });
    expect(r.closedCount).toBe(2);
    expect(r.avgRemovalHours).toBe(72);
    expect(r.lateCount).toBe(2);
    expect(r.emailVerifiedPct).toBe(40);
    expect(r.unknownPct).toBe(20);
    expect(r.score).toBe(Math.round((0.6 * (100 / 3) + 0.4 * 80) / 1));
  });
  it("veri yoksa sahte puan yok", () => {
    expect(computeComplianceReport({ nowMs: FRI, tasks: [], portfolio: null }).score).toBeNull();
  });
});

describe("sözleşme", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("migration + rollback çifti; kapanış kapısı ve eklenti tetiği DB'de", () => {
    const sql = read("supabase/migrations/20261013007300_eids_actions.sql");
    expect(sql).toContain("'eids_publish', 'eids_takedown'");
    expect(sql).toContain("'urgent'");
    expect(sql).toContain("tasks_tenant_dedupe_key_uidx");
    expect(sql).toContain("eids_takedown_pending_items");
    expect(sql).toContain("confirmed_missing");
    expect(sql).toContain("'sms', 'whatsapp', 'email'");
    expect(existsSync(join(process.cwd(), "supabase/rollbacks/20261013007300_eids_actions.rollback.sql"))).toBe(true);
  });
  it("aksiyon motoru service_role istemcisi OLUŞTURMAZ ve yetki durumunu yazmaz", () => {
    const src = read("src/lib/eids/actions.ts");
    expect(src).not.toMatch(/createAdminClient\(/);
    expect(src).not.toMatch(/update\(\{[^}]*authority_eids_status/);
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).toContain("dedupe_key: dedupeKey");
  });
  it("cron adımı mevcut gorev-hatirlat içinde (yeni cron yok)", () => {
    expect(read("src/app/api/cron/gorev-hatirlat/route.ts")).toContain("runEidsActionSweep(admin, now)");
  });
  it("admin paneli malik adını okumaz (grantor sütunu seçilmez) ve örneği yeniden maskeler", () => {
    const src = read("src/app/admin/sistem/eids-intake-panel.tsx");
    expect(src).not.toMatch(/grantor/);
    expect(src).toContain("maskSampleForAdmin(");
  });
});

describe("admin maskesi", () => {
  it("malik adı, e-posta ve uzun numara gizlenir", () => {
    const t = maskSampleForAdmin("123456789 taşınmaz numaralı taşınmazın satışına ilişkin ilan konusunda AHMET YILMAZ tarafından yetki iptal edilmiştir. ahmet@ornek.com");
    expect(t).not.toContain("AHMET");
    expect(t).not.toContain("ahmet@");
    expect(t).toContain("******789");
    expect(t).toContain("konusunda *** tarafından");
    expect(maskSampleForAdmin(null)).toBe("");
  });
});
