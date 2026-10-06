import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { computeOfficeScore, type OfficeScoreInputs } from "@/lib/office-score";
import { explainOfficeScore, OFFICE_SCORE_BASE } from "@/lib/office-score-breakdown";

const inputs = (over: Partial<OfficeScoreInputs> = {}): OfficeScoreInputs => ({
  openDemands: 0,
  livePortals: 0,
  overdueConfirmations: 0,
  closures30d: 0,
  appointments7d: 0,
  calls7d: 0,
  ...over,
});

describe("ofis sağlık skoru bileşen kırılımı", () => {
  const CASES: OfficeScoreInputs[] = [
    inputs(),
    inputs({ openDemands: 3, livePortals: 4, appointments7d: 2, calls7d: 5, closures30d: 1 }),
    inputs({ openDemands: 99, livePortals: 99, appointments7d: 99, calls7d: 99, closures30d: 99 }),
    inputs({ overdueConfirmations: 9 }),
    inputs({ openDemands: 1, overdueConfirmations: 2, closures30d: 2 }),
  ];

  it("toplam computeOfficeScore ile BİREBİR aynı (formül kayması testi kırar)", () => {
    for (const c of CASES) {
      expect(explainOfficeScore(c).total).toBe(computeOfficeScore(c).score);
    }
  });

  it("sabit 42 başlangıcı 'taban' olarak AÇIKÇA etiketli, veriden gelmiyor ve hedefi yok", () => {
    const base = explainOfficeScore(inputs()).components.find((c) => c.key === "base");
    expect(base?.points).toBe(OFFICE_SCORE_BASE);
    expect(OFFICE_SCORE_BASE).toBe(42);
    expect(base?.label).toContain("Taban");
    expect(base?.value).toBeNull();
    expect(base?.href).toBeNull();
  });

  it("her veri bileşeni filtrelenmiş bir hedefe gider (sıfır çıkmaz metrik) ve üst sınırını aşmaz", () => {
    const { components } = explainOfficeScore(CASES[2]);
    for (const c of components.filter((x) => x.key !== "base")) {
      expect(c.href, c.key).toMatch(/^\/app\//);
      expect(Math.abs(c.points), c.key).toBeLessThanOrEqual(Math.abs(c.max));
      expect(c.hint.length, c.key).toBeGreaterThan(0);
    }
  });

  it("ceza negatif katkı olarak görünür", () => {
    const overdue = explainOfficeScore(inputs({ overdueConfirmations: 2 })).components.find((c) => c.key === "overdue");
    expect(overdue?.points).toBe(-14);
    expect(explainOfficeScore(inputs({ overdueConfirmations: 20 })).components.find((c) => c.key === "overdue")?.points).toBe(-28);
  });
});
