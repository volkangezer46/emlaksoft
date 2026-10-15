import { describe, expect, it } from "vitest";
import { FAQ } from "@/lib/help-faq";
import { buildAdvisorScope } from "@/lib/ai/advisor-scope";
import { DEFAULT_MATRIX } from "@/lib/permissions";
import { FALLBACK_NOTE, detectTopics, fallbackAdvisorActions, fallbackTenantAdvisor, type TenantAdvisorContext } from "./tenant-advisor-fallback";

const ctx: TenantAdvisorContext = {
  scope: buildAdvisorScope({ ...DEFAULT_MATRIX.owner }, "owner", "u1"),
  customers: 40,
  properties: 25,
  activeDeals: 6,
  wonThisMonth: 3,
  wonValueThisMonth: 14_500_000,
  collectedThisMonth: 262_260,
  newDemands: 2,
  openTasks: 5,
  tasksOverdue: 1,
  tasksDueToday: 2,
  todayAppointments: 1,
  pendingCommission: 50_000,
  hotLeadCount: 1,
  hotLeads: [{ id: "c1", name: "Ayşe Kaya", score: 82 }],
  overpricedCount: 25,
  overpriced: [{ id: "p1", label: "Kadıköy 3+1", price: 9_000_000 }],
};

const ask = (q: string) => [{ role: "user" as const, content: q }];

describe("asistan yedek kipi (B190)", () => {
  it("'Portföy neden taslak?' fiyat konusuna değil taslak SSS'ine gider", () => {
    const t = detectTopics(ask("[SAHA] Portföy neden taslak?"));
    expect(t.price).toBe(false);
    expect(t.howWhy).toBe(true);
    const reply = fallbackTenantAdvisor(ask("[SAHA] Portföy neden taslak?"), ctx, FAQ);
    expect(reply).toContain("taslak");
    expect(reply).not.toContain("Fiyatı yüksek portföyler");
    expect(fallbackAdvisorActions(ask("Portföy neden taslak?"), ctx)).toEqual([]);
  });

  it("'bu ay ciro' tahsil edilen komisyonla yanıtlanır; satış hacmi ayrı etiketli", () => {
    const reply = fallbackTenantAdvisor(ask("bu ay ciro ne kadar?"), ctx, FAQ);
    expect(reply).toContain("₺262.260");
    expect(reply).toMatch(/cirosu \(tahsil edilen komisyon\)/);
    expect(reply).toContain("Satış hacmi");
    expect(reply.indexOf("₺262.260")).toBeLessThan(reply.indexOf("₺14.500.000"));
  });

  it("teknik not yok; sakin açıklama ve uygulama içi bağlantılar var", () => {
    const reply = fallbackTenantAdvisor(ask("bugün kimi aramalıyım?"), ctx, FAQ);
    expect(reply).not.toMatch(/OpenAI|anahtar/i);
    expect(reply).toContain(FALLBACK_NOTE);
    expect(reply).toContain("[Ayşe Kaya](/app/musteriler/c1)");
    expect(reply).not.toMatch(/skor/i);
    expect(reply).not.toMatch(/(^|\s)\/app\/musteriler\/c1/);
  });

  it("komisyon izni yoksa ciro sayısı verilmez", () => {
    const reply = fallbackTenantAdvisor(ask("bu ayki ciro?"), { ...ctx, collectedThisMonth: null }, FAQ);
    expect(reply).not.toContain("₺262.260");
    expect(reply).toContain("yetkiniz yok");
  });
});
