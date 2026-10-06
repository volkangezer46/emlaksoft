import { describe, expect, it } from "vitest";
import {
  ATTENTION_LIMIT,
  attentionLevel,
  buildAttentionQueue,
  buildChurnRows,
  churnLevel,
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
  newTrials: 0,
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
      { refundRequired: 1, manualReview: 1, cronErrors: 1, efReconciliation: "drift", urgentTickets: 1, openTickets: 3, risk: 1, trialsEnding: 1, newTrials: 1 },
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

  it("deneme ofisi hareketsiz/sessiz diye churn sayılmaz; deneme bitişi churn sinyali DEĞİL (yalnız dikkat kuyruğunda)", () => {
    const rows = buildChurnRows(
      [
        { id: "n", name: "Yeni", status: "trial", trial_ends_at: new Date(NOW + 20 * day).toISOString() },
        { id: "e", name: "Bitiyor", status: "trial", trial_ends_at: new Date(NOW + 2 * day).toISOString() },
        { id: "s", name: "Sessiz deneme", status: "trial", trial_ends_at: null },
      ],
      new Map([["e", 15], ["s", 3]]),
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it("askıdaki ofis riskli listeye girer (riskli ofis + churn tek liste); iptal dışlanır; limit uygulanır", () => {
    const rows = buildChurnRows(
      [
        { id: "a", name: "Askıda", status: "suspended", trial_ends_at: null },
        { id: "c", name: "İptal", status: "cancelled", trial_ends_at: null },
      ],
      new Map([["a", 12]]),
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["a"]);
    expect(rows[0]!.signals.map((s) => s.label)).toEqual(["Askıda"]);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, status: "past_due", trial_ends_at: null }));
    expect(buildChurnRows(many, new Map(), NOW, 5)).toHaveLength(5);
  });

  it("son hareket zamanı ve risk düzeyi satıra işlenir", () => {
    const rows = buildChurnRows(
      [{ id: "p", name: "Gecikmiş", status: "past_due", trial_ends_at: null }],
      new Map([["p", 4]]),
      NOW,
      8,
      new Map([["p", "2026-10-01T09:00:00Z"]]),
    );
    expect(rows[0]!.lastActivityAt).toBe("2026-10-01T09:00:00Z");
    expect(rows[0]!.signals.map((s) => s.label)).toEqual(["Ödeme gecikmesi", "Düşük kullanım"]);
    expect(rows[0]!.level).toBe("orta");
  });
});

describe("önem / risk düzeyleri", () => {
  it("dikkat şiddeti → Acil/Yüksek/Orta/Düşük", () => {
    expect([100, 85, 80, 70, 65, 50, 45, 40].map(attentionLevel)).toEqual(["acil", "acil", "yuksek", "yuksek", "orta", "orta", "dusuk", "dusuk"]);
  });
  it("churn skoru → düzey", () => {
    expect([6, 5, 4, 3, 1].map(churnLevel)).toEqual(["yuksek", "yuksek", "orta", "orta", "dusuk"]);
  });
});
