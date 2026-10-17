import { describe, expect, it } from "vitest";
import { backupHealthy, backupWhen, buildTeamToday, type TeamProfile } from "./core";
import { buildSamplePresence } from "@/lib/sample-data/presence-seed";

// 17 Ekim 2026 14:00 TR (11:00 UTC); gün başı 16 Eki 21:00 UTC.
const NOW = Date.UTC(2026, 9, 17, 11);
const DAY_START = "2026-10-16T21:00:00.000Z";
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const prof = (id: string, extra: Partial<TeamProfile> = {}): TeamProfile => ({ id, full_name: `Kişi ${id}`, avatar_url: null, avatar_preset: null, role: "advisor", title: null, is_active: true, ...extra });

describe("buildTeamToday: durum + denetim kaydı birleşimi", () => {
  it("durum hapı, unvan/rol, son görülme ve sıra", () => {
    const { people, total } = buildTeamToday({
      profiles: [prof("a", { title: "Kiralama uzmanı" }), prof("b", { role: "gm" }), prof("c"), prof("d"), prof("e", { is_active: false })],
      logs: new Map([
        ["c", { action: "property.update", entity_type: "property", created_at: iso(NOW - 3 * MIN) }],
        ["d", { action: "customer.create", entity_type: "customer", created_at: iso(NOW - 2 * 86_400_000) }],
        ["e", { action: "x", entity_type: "task", created_at: iso(NOW - MIN) }],
      ]),
      presence: new Map([
        ["a", { status: "field", note: "Kadıköy", updated_at: iso(NOW - 40 * MIN) }],
        ["b", { status: "office", updated_at: iso(NOW - 10 * MIN) }],
        ["c", { status: "away", updated_at: iso(Date.UTC(2026, 9, 16, 15)) }], // dün → Çevrimdışı ama bugün kaydı var
      ]),
      nowMs: NOW,
      dayStartIso: DAY_START,
    });
    expect(people.map((p) => [p.id, p.presence, p.today])).toEqual([
      ["b", "office", true],
      ["a", "field", true],
      ["c", "offline", true],
      ["d", null, false],
    ]);
    expect(total).toBe(3);
    expect(people[0]!.roleTitle).toBe("Genel müdür");
    expect(people[1]!.roleTitle).toBe("Kiralama uzmanı");
    expect(people[1]!.note).toBe("Kadıköy");
    // c: son görülme bugünkü kayıt (dünkü durumdan geç), faaliyet adı kayıttan.
    expect(people[2]!.atMs).toBe(NOW - 3 * MIN);
    expect(people[2]!.activity).toBe("İlan güncelliyor");
    expect(people[3]!.day).toBe("2026-10-15");
  });

  it("profili olmayan (ofis dışı) kişi ve ne durumu ne kaydı olan profil listelenmez", () => {
    const r = buildTeamToday({ profiles: [prof("z")], logs: new Map([["x", { action: null, entity_type: null, created_at: iso(NOW) }]]), presence: new Map(), nowMs: NOW, dayStartIso: DAY_START });
    expect(r).toEqual({ people: [], total: 0 });
  });

  it("demo ekip durumu (örnek satır) her gün canlı ve çeşitli", () => {
    const rows = buildSamplePresence("t", ["p1", "p2", "p3", "p4", "p5"], NOW - 5 * 86_400_000);
    const r = buildTeamToday({
      profiles: ["p1", "p2", "p3", "p4", "p5"].map((id) => prof(id)),
      logs: new Map(),
      presence: new Map(rows.map((x) => [x.user_id, x])),
      nowMs: NOW,
      dayStartIso: DAY_START,
    });
    expect(r.total).toBe(5);
    expect(new Set(r.people.map((p) => p.presence)).size).toBe(5);
    expect(r.people.every((p) => NOW - p.atMs < 6 * 3_600_000)).toBe(true);
  });
});

describe("Ofis durumu alt satırı: son yedekleme", () => {
  it("Bugün / Dün / tarih", () => {
    expect(backupWhen(Date.UTC(2026, 9, 17, 0, 42), NOW)).toBe("Bugün 03:42");
    expect(backupWhen(Date.UTC(2026, 9, 16, 0, 42), NOW)).toBe("Dün 03:42");
    expect(backupWhen(Date.UTC(2026, 9, 12, 0, 42), NOW)).toBe("12 Eki 03:42");
  });
  it("sağlık: durum ok ve ≤2 gün", () => {
    expect(backupHealthy({ atMs: NOW - 10 * 3_600_000, status: "ok" }, NOW)).toBe(true);
    expect(backupHealthy({ atMs: NOW - 3 * 86_400_000, status: "ok" }, NOW)).toBe(false);
    expect(backupHealthy({ atMs: NOW - 3_600_000, status: "error" }, NOW)).toBe(false);
  });
});
