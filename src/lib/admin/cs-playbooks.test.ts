import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import {
  capPerRule,
  evaluateCancel,
  evaluateCsat,
  evaluateHealth,
  evaluateNps,
  evaluateTrialInactive,
  playbookNote,
  PLAYBOOK_RULE_CAP,
  type PlaybookDraft,
} from "./cs-playbooks";

const NOW = Date.UTC(2026, 9, 15, 5, 0, 0); // 08:00 TSİ
const names = new Map([["t1", "Ofis A"], ["t2", "Ofis B"]]);
const opts = { todayKey: "2026-10-15", threshold: 40, dropPoints: 15, nowMs: NOW };

describe("sağlık kuralları", () => {
  it("riskli eşiğin altına İLK iniş yüksek öncelikli tek görev açar (düşüş görevi ayrıca açılmaz)", () => {
    const d = evaluateHealth(
      [
        { tenantId: "t1", day: "2026-10-10", score: 70 },
        { tenantId: "t1", day: "2026-10-14", score: 45 },
        { tenantId: "t1", day: "2026-10-15", score: 35 },
      ],
      names,
      opts,
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ rule: "health_threshold", tenantId: "t1", priority: "yuksek", dueInDays: 1 });
    expect(d[0]!.title).toContain("Ofis A");
    expect(d[0]!.dedupeKey).toMatch(/^health_threshold:t1:/);
  });

  it("zaten eşik altındaysa iniş görevi yok; 7 günde ≥15 puan düşüş görevi açılır", () => {
    const d = evaluateHealth(
      [
        { tenantId: "t2", day: "2026-10-09", score: 38 },
        { tenantId: "t2", day: "2026-10-12", score: 80 },
        { tenantId: "t2", day: "2026-10-14", score: 70 },
        { tenantId: "t2", day: "2026-10-15", score: 62 },
      ],
      names,
      opts,
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ rule: "health_drop", priority: "normal" });
    expect(d[0]!.title).toContain("18 puan");
  });

  it("bugünkü skor yoksa ya da düşüş eşik altındaysa görev yok", () => {
    expect(evaluateHealth([{ tenantId: "t1", day: "2026-10-14", score: 90 }], names, opts)).toEqual([]);
    expect(
      evaluateHealth(
        [
          { tenantId: "t1", day: "2026-10-14", score: 80 },
          { tenantId: "t1", day: "2026-10-15", score: 70 },
        ],
        names,
        opts,
      ),
    ).toEqual([]);
  });
});

describe("NPS / CSAT / iptal / deneme", () => {
  it("NPS 0-6 kötüleyen; 0-3 öncelikli; 7+ görev açmaz; anahtar yanıt başına", () => {
    const d = evaluateNps([
      { id: "r1", tenantId: "t1", name: "A", score: 2, comment: "Çok yavaş" },
      { id: "r2", tenantId: "t1", name: "A", score: 6, comment: null },
      { id: "r3", tenantId: "t1", name: "A", score: 9, comment: null },
    ]);
    expect(d.map((x) => [x.dedupeKey, x.priority])).toEqual([
      ["nps:r1", "yuksek"],
      ["nps:r2", "normal"],
    ]);
    expect(d[0]!.body).toContain("Çok yavaş");
  });

  it("CSAT 1-2 görev açar, 3+ açmaz", () => {
    expect(evaluateCsat([{ ticketId: "k1", tenantId: "t1", name: "A", score: 1, comment: null }, { ticketId: "k2", tenantId: "t1", name: "A", score: 3, comment: null }]).map((x) => x.dedupeKey)).toEqual(["csat:k1"]);
  });

  it("iptal talebi: talep gününe bağlı anahtar (vazgeçip yeniden isterse yeni görev)", () => {
    const [d] = evaluateCancel([{ subscriptionId: "s1", tenantId: "t1", name: "A", requestedAt: "2026-10-14T10:00:00Z", periodEnd: "2026-11-01T00:00:00Z", reason: "Pahalı" }]);
    expect(d).toMatchObject({ rule: "cancel_request", priority: "yuksek", dedupeKey: "cancel:s1:2026-10-14" });
    expect(d!.body).toContain("2026-11-01");
  });

  it("deneme: yalnız 3-7. günde ve portföyü olmayan ofis", () => {
    const at = (days: number) => new Date(NOW - days * DAY_MS).toISOString();
    const d = evaluateTrialInactive(
      [
        { tenantId: "a", name: "A", createdAt: at(4), properties: 0 },
        { tenantId: "b", name: "B", createdAt: at(2), properties: 0 },
        { tenantId: "c", name: "C", createdAt: at(5), properties: 3 },
        { tenantId: "d", name: "D", createdAt: at(8), properties: 0 },
      ],
      NOW,
    );
    expect(d.map((x) => x.dedupeKey)).toEqual(["trial_inactive:a"]);
  });
});

describe("tekrar ve sel freni", () => {
  it("aynı anahtar bir kez; kural başına üst sınır", () => {
    const many: PlaybookDraft[] = Array.from({ length: PLAYBOOK_RULE_CAP + 5 }, (_, i) => ({ rule: "low_csat", tenantId: "t", title: "x", body: "y", dueInDays: 1, priority: "normal", dedupeKey: `csat:${i}` }));
    const dup = { ...many[0]! };
    const out = capPerRule([dup, ...many]);
    expect(out).toHaveLength(PLAYBOOK_RULE_CAP);
    expect(new Set(out.map((d) => d.dedupeKey)).size).toBe(PLAYBOOK_RULE_CAP);
  });

  it("heartbeat özeti", () => {
    expect(playbookNote({ skipped: false, created: { nps_detractor: 2 }, unassigned: 1, error: null })).toBe("2 görev (NPS kötüleyen 2), 1 sahipsiz");
    expect(playbookNote({ skipped: true, created: {}, unassigned: 0, error: null })).toBe("atlandı");
    expect(playbookNote(undefined)).toBe("hata verdi");
  });
});
