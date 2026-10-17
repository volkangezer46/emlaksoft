import { describe, expect, it } from "vitest";
import { buildAttentionRows, collapseFeed, cronTileStatus } from "./home-rules";

/**
 * F13 (ui) — Kontrol paneli tek önem kuralı: kahraman "N acil konu" = Dikkat kartındaki "Acil" rozet sayısı (aynı satır
 * listesi); kuyruk adedi rozet sütununda değil (rozetler hizalı); cron karosu kendi ölçüsünden ("40/40" → Tümü çalışıyor);
 * akıştaki tekrar olaylar katlanır.
 */
const NOW = Date.parse("2026-10-27T09:00:00Z");

const home = {
  ok: true,
  records: {
    overdue: [],
    // Yedi SLA aşımı (somut kayıt, önem 88 → acil) — eskiden hero yalnız kuyruğu sayıp "2 acil konu" diyordu.
    sla: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, subject: `Talep ${i}`, first_response_due_at: "2026-10-27T06:00:00Z", tenant: { name: "Ofis" } })),
    approvals: [{ id: "a1", summary: "Rol değişikliği", requested_at: "2026-10-27T08:00:00Z" }],
  },
  churnTenants: [],
  health: { failedJobs: [] },
  queue: [
    { id: "refund", label: "İade bekliyor", hint: "Ödeme sağlayıcısı", href: "/admin/billing/tahsilat", count: 3, severity: 95 },
    { id: "urgent-ticket", label: "Acil destek talebi", hint: "Öncelik acil", href: "/admin/tickets", count: 2, severity: 90 },
    { id: "risk", label: "Riskli ofis", hint: "Sağlık skoru düşük", href: "/admin/tenants", count: 1, severity: 60 },
  ],
} as never;

describe("buildAttentionRows (tek önem kuralı)", () => {
  const rows = buildAttentionRows(home, { kvkk: 2 } as never, "super_admin" as never, NOW);

  it("hero sayımı ile kart rozetleri aynı listeden: acil = önem ≥ 85", () => {
    const acil = rows.filter((r) => r.level === "acil");
    // 5 SLA kaydı + iade (95); "urgent-ticket" SLA kayıtları varken tekrar edilmez.
    expect(acil).toHaveLength(6);
    expect(rows.find((r) => r.id === "urgent-ticket")).toBeUndefined();
    for (const r of rows) expect(r.level === "acil").toBe(r.severity >= 85);
    expect(rows.map((r) => r.severity)).toEqual([...rows.map((r) => r.severity)].sort((a, b) => b - a));
  });

  it("kuyruk adedi rozet sütununa değil etikete yazılır (meta yok → rozetler hizalı)", () => {
    for (const r of rows) expect(r.meta ?? null).toBeNull();
    expect(rows.find((r) => r.id === "refund")?.more).toBe("×3");
    expect(rows.find((r) => r.id === "risk")?.more).toBeNull();
    expect(rows.find((r) => r.id === "kvkk")?.more).toBe("×2");
  });
});

describe("cronTileStatus", () => {
  it("40/40 → Tümü çalışıyor (genel sistem uyarısından bağımsız)", () => {
    expect(cronTileStatus(40, 0)).toMatchObject({ value: "40/40", tone: "mint", chip: { text: "Tümü çalışıyor", tone: "success" } });
  });
  it("hata varsa sayı ve kırmızı; okunamazsa —", () => {
    expect(cronTileStatus(40, 2)).toMatchObject({ value: "38/40", tone: "rose", chip: { text: "2 hatalı", tone: "danger" }, href: "/admin/sistem" });
    expect(cronTileStatus(null, null)).toMatchObject({ value: "—", chip: null });
  });
});

describe("collapseFeed", () => {
  it("aynı olay tekrarları tek satır ×N; sıra korunur", () => {
    const demo = (i: number) => ({ id: `a${i}`, at: `2026-10-27T08:0${i}:00Z`, label: "Demo girişi yapıldı", hint: "Platform işlemi", href: "/admin/aktivite" });
    const rows = [demo(9), { id: "k1", at: "2026-10-27T08:08:30Z", label: "Fatura sorusu", hint: "Yeni destek talebi", href: "/admin/tickets/k1" }, ...[8, 7, 6, 5, 4, 3, 2].map(demo)];
    const out = collapseFeed(rows);
    expect(out.map((r) => [r.label, r.times])).toEqual([
      ["Demo girişi yapıldı", 8],
      ["Fatura sorusu", 1],
    ]);
    expect(out[0]!.at).toBe("2026-10-27T08:09:00Z");
  });
});

describe("[SAHA] test talepleri ana ekran okumalarına girmez (F1-ui)", () => {
  it("SLA sayımı, SLA satırları, acil talep sayımı ve bugünün talepleri [SAHA] konusunu süzer", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/app/admin/_dashboards/platform-sections.tsx`, "utf8");
    expect(src).toContain('export const SAHA_SUBJECT = "[SAHA]*";');
    expect(src.match(/\.not\("subject", "like", SAHA_SUBJECT\)/g)?.length).toBe(4);
  });
});
