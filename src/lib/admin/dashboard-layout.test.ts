import { describe, expect, it } from "vitest";
import {
  ATTENTION_LIMIT,
  buildAttentionQueue,
  buildChurnRows,
  homeVariantFor,
  platformHomeSections,
  type AttentionInput,
} from "./dashboard-layout";

const EMPTY: AttentionInput = {
  refundRequired: 0,
  manualReview: 0,
  cronErrors: 0,
  efReconciliation: "ok",
  urgentTickets: 0,
  openTickets: 0,
  risk: 0,
  trialsEnding: 0,
  demoRequests: 0,
};

describe("homeVariantFor / platformHomeSections", () => {
  it("billing ve support kendi panelini, diğerleri platform panelini görür", () => {
    expect(homeVariantFor("billing")).toBe("billing");
    expect(homeVariantFor("support")).toBe("support");
    expect(homeVariantFor("super_admin")).toBe("platform");
    expect(homeVariantFor("ops")).toBe("platform");
  });

  it("super_admin gelir bölümlerini görür, ops görmez (billing modülü yok)", () => {
    const sa = platformHomeSections("super_admin");
    const ops = platformHomeSections("ops");
    expect(sa).toContain("mrr");
    expect(sa).toContain("composition");
    expect(ops).not.toContain("mrr");
    expect(ops).not.toContain("composition");
    expect(sa[0]).toBe("attention");
    expect(ops[0]).toBe("attention");
  });

  it("bölümler tekrarsızdır ve geo yalnız erişimi olan rolde çıkar", () => {
    for (const r of ["super_admin", "ops"] as const) {
      const s = platformHomeSections(r);
      expect(new Set(s).size).toBe(s.length);
      expect(s).toContain("geo");
    }
  });
});

describe("buildAttentionQueue", () => {
  it("hiçbir sinyal yoksa boş döner (sahte satır yok)", () => {
    expect(buildAttentionQueue(EMPTY, "super_admin")).toEqual([]);
  });

  it("null (okunamadı) ve 0 sayılar gizlenir", () => {
    const q = buildAttentionQueue({ ...EMPTY, refundRequired: null, manualReview: 0, urgentTickets: 2, openTickets: 2 }, "super_admin");
    expect(q.map((r) => r.id)).toEqual(["urgent-ticket"]);
  });

  it("şiddete göre sıralar: iade > manuel inceleme > cron > acil destek", () => {
    const q = buildAttentionQueue(
      { ...EMPTY, urgentTickets: 9, openTickets: 9, cronErrors: 1, manualReview: 2, refundRequired: 1 },
      "super_admin",
    );
    expect(q.map((r) => r.id)).toEqual(["refund", "manual-review", "cron", "urgent-ticket"]);
  });

  it("açık destek sayısı acilleri düşer (çift sayım yok)", () => {
    const q = buildAttentionQueue({ ...EMPTY, urgentTickets: 2, openTickets: 5 }, "ops");
    expect(q.find((r) => r.id === "open-ticket")?.count).toBe(3);
  });

  it("rol filtresi: ops ödeme satırlarını görmez, super_admin görür", () => {
    const input = { ...EMPTY, refundRequired: 1, manualReview: 1, cronErrors: 1, efReconciliation: "drift" as const };
    expect(buildAttentionQueue(input, "ops").map((r) => r.id)).toEqual(["cron"]);
    expect(buildAttentionQueue(input, "super_admin").map((r) => r.id)).toEqual(["refund", "manual-review", "cron", "ef-drift"]);
  });

  it("EF sapması yalnız drift/error durumunda görünür ve ef-kontor sayfasına bağlanır", () => {
    expect(buildAttentionQueue({ ...EMPTY, efReconciliation: null }, "super_admin")).toEqual([]);
    const q = buildAttentionQueue({ ...EMPTY, efReconciliation: "error" }, "super_admin");
    expect(q[0]?.href).toBe("/admin/ef-kontor");
  });

  it("her satırın href'i /admin ile başlar ve sayı pozitiftir", () => {
    const q = buildAttentionQueue(
      { refundRequired: 1, manualReview: 1, cronErrors: 1, efReconciliation: "drift", urgentTickets: 1, openTickets: 3, risk: 1, trialsEnding: 1, demoRequests: 1 },
      "super_admin",
    );
    expect(q.length).toBeLessThanOrEqual(ATTENTION_LIMIT);
    for (const r of q) {
      expect(r.href.startsWith("/admin/")).toBe(true);
      expect(r.count).toBeGreaterThan(0);
    }
  });
});

describe("buildChurnRows", () => {
  const NOW = Date.UTC(2026, 9, 6, 12);
  const day = 86_400_000;

  it("veri yoksa boş döner", () => {
    expect(buildChurnRows([], new Map(), NOW)).toEqual([]);
  });

  it("aktif ve hareketli ofis listelenmez", () => {
    const rows = buildChurnRows([{ id: "a", name: "A", status: "active", trial_ends_at: null }], new Map([["a", 40]]), NOW);
    expect(rows).toEqual([]);
  });

  it("gecikmiş ve hareketsiz ofis en üstte, sinyaller açıklanır", () => {
    const rows = buildChurnRows(
      [
        { id: "q", name: "Sessiz", status: "active", trial_ends_at: null },
        { id: "p", name: "Gecikmiş", status: "past_due", trial_ends_at: null },
      ],
      new Map([["q", 3]]),
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["p", "q"]);
    expect(rows[0]!.signals.map((s) => s.key)).toEqual(["past_due", "inactive"]);
    expect(rows[0]!.href).toBe("/admin/tenants/p");
  });

  it("yeni deneme tek başına hareketsizlikle risk sayılmaz; bitmek üzere olan sayılır", () => {
    const rows = buildChurnRows(
      [
        { id: "n", name: "Yeni", status: "trial", trial_ends_at: new Date(NOW + 20 * day).toISOString() },
        { id: "e", name: "Bitiyor", status: "trial", trial_ends_at: new Date(NOW + 2 * day).toISOString() },
      ],
      new Map([["e", 15]]),
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["e"]);
  });

  it("iptal/askıdaki ofisler dışlanır ve limit uygulanır", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, status: "past_due", trial_ends_at: null }));
    expect(buildChurnRows([...many, { id: "c", name: "C", status: "cancelled", trial_ends_at: null }], new Map(), NOW, 5)).toHaveLength(5);
  });
});
