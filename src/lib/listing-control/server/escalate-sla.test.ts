import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notify", () => ({ notifyTenant: vi.fn() }));

import { anomalyHref, slaChainStartMs, slaTaskTitle } from "./escalate";
import { planSlaEscalation } from "../sla-plan";

const H = 3_600_000;

describe("SLA zinciri başlangıcı ve görev", () => {
  it("yeni anomali: ilk görülme; yeniden açılan: yeniden açılış anı (kademeler aynı anda tetiklenmez)", () => {
    const first = "2026-10-01T08:00:00.000Z";
    expect(slaChainStartMs(first, null, 4)).toBe(Date.parse(first));
    expect(slaChainStartMs(first, "2026-10-01T12:00:00.000Z", 4)).toBe(Date.parse(first));
    const reopenedDue = "2026-10-05T14:00:00.000Z"; // 10:00'da yeniden açıldı, vade 4 saat sonra
    const start = slaChainStartMs(first, reopenedDue, 4);
    expect(start).toBe(Date.parse("2026-10-05T10:00:00.000Z"));
    const decisions = planSlaEscalation({
      openedAtMs: start,
      nowMs: start + 1 * H,
      firedStages: [],
      recipients: { advisorId: "a", teamLeadId: "t", branchManagerId: "b", ownerIds: ["o"] },
    });
    expect(decisions.map((d) => d.stage)).toEqual([1]);
  });
  it("görev başlığı türe göre sabit (aynı portföyde ikinci görev açılmaz), bağlantı filtreli kuyruğa gider", () => {
    expect(slaTaskTitle("portal_missing")).toBe("İlan uyarısı: Portal ilanı kayıp");
    expect(slaTaskTitle("unregistered_listing")).toBe("İlan uyarısı: Portalda CRM'e kayıtsız ilan");
    expect(anomalyHref("p 1")).toBe("/app/ilan-kontrol/anomaliler?portfoy=p%201");
  });
});
