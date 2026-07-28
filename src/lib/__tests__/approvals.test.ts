import { describe, expect, it } from "vitest";
import {
  averageDecisionHours,
  canDecide,
  formatDelta,
  isManagerRole,
  isOverdue,
  kindMeta,
  slaHours,
  waitingLabel,
} from "@/lib/approvals";

const HOUR = 3_600_000;

describe("formatDelta", () => {
  it("komisyon indirimini PUAN farkıyla yazar (yüzdenin yüzdesi değil)", () => {
    const d = formatDelta(3, 2, "komisyon_indirimi");
    expect(d.text).toBe("%3 → %2 (−1 puan)");
    expect(d.direction).toBe("azalis");
  });

  it("para değerinde yüzdesel azalışı hesaplar", () => {
    const d = formatDelta(12000, 9500, "gider");
    // 12.000 → 9.500 = −%20,83 → yuvarlanmış −%21
    expect(d.text).toBe("12.000 ₺ → 9.500 ₺ (−%21)");
    expect(d.changePct).toBe(-21);
    expect(d.direction).toBe("azalis");
  });

  it("artışı + işaretiyle ve mint yönüyle raporlar", () => {
    const d = formatDelta(10000, 12500, "fiyat_degisikligi");
    expect(d.text).toBe("10.000 ₺ → 12.500 ₺ (+%25)");
    expect(d.changePct).toBe(25);
    expect(d.direction).toBe("artis");
  });

  it("sıfır bölmede yüzde uydurmaz — mutlak farkı gösterir", () => {
    const d = formatDelta(0, 5000, "gider");
    expect(d.text).toBe("0 ₺ → 5.000 ₺ (+5.000 ₺)");
    expect(d.changePct).toBeNull();
    expect(d.direction).toBe("artis");
  });

  it("değer yoksa/eksikse çökmez", () => {
    expect(formatDelta(null, null, "gider").text).toBe("—");
    expect(formatDelta(null, null, "gider").direction).toBe("yok");
    expect(formatDelta(undefined, 4200, "gider").text).toBe("4.200 ₺");
    expect(formatDelta(4200, undefined, "gider").text).toBe("4.200 ₺");
  });

  it("değişiklik yoksa sabit döner", () => {
    const d = formatDelta(3, 3, "komisyon_indirimi");
    expect(d.direction).toBe("sabit");
    expect(d.text).toContain("değişiklik yok");
  });

  it("bilinmeyen tür `diger` gibi davranır (birimsiz)", () => {
    expect(kindMeta("uydurma_tur").label).toBe("Diğer");
    const d = formatDelta(10, 8, "uydurma_tur");
    expect(d.text).toBe("10 → 8 (−%20)");
  });
});

describe("slaHours / isOverdue", () => {
  it("türe göre SLA verir; bilinmeyen tür diger eşiğine düşer", () => {
    expect(slaHours("komisyon_indirimi")).toBe(24);
    expect(slaHours("gider")).toBe(48);
    expect(slaHours("fiyat_degisikligi")).toBe(24);
    expect(slaHours("ozel_izin")).toBe(72);
    expect(slaHours("uydurma_tur")).toBe(72);
  });

  it("tam SLA sınırında HENÜZ gecikmiş sayılmaz", () => {
    const now = 1_800_000_000_000;
    const created = new Date(now - 24 * HOUR).toISOString();
    expect(isOverdue(created, "komisyon_indirimi", now)).toBe(false);
  });

  it("sınırın bir dakika ötesinde gecikmiştir", () => {
    const now = 1_800_000_000_000;
    const created = new Date(now - (24 * HOUR + 60_000)).toISOString();
    expect(isOverdue(created, "komisyon_indirimi", now)).toBe(true);
    // Aynı yaş, gider türünde (48 saat) hâlâ süresi içinde
    expect(isOverdue(created, "gider", now)).toBe(false);
  });

  it("geçersiz tarihte false döner (sayfa patlamasın)", () => {
    expect(isOverdue("olmayan-tarih", "gider", 1_800_000_000_000)).toBe(false);
  });
});

describe("isManagerRole", () => {
  it("yalnız yönetim kademesini kabul eder", () => {
    for (const r of ["owner", "gm", "branch_manager", "team_lead"]) {
      expect(isManagerRole(r)).toBe(true);
    }
    for (const r of ["advisor", "accounting", "call_center", "readonly", "", null, undefined]) {
      expect(isManagerRole(r)).toBe(false);
    }
  });
});

describe("canDecide — karar kapısı", () => {
  const base = { role: "branch_manager", status: "bekliyor", requestedBy: "danisman-1", userId: "mudur-1" };

  it("yönetici, başkasının bekleyen talebine karar verebilir", () => {
    expect(canDecide(base)).toEqual({ ok: true });
  });

  it("KENDİ talebini onaylayamaz — yönetici olsa bile", () => {
    const res = canDecide({ ...base, requestedBy: "mudur-1", userId: "mudur-1" });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: "Kendi talebinizi onaylayamaz veya reddedemezsiniz." });
  });

  it("owner bile kendi talebine karar veremez", () => {
    expect(canDecide({ role: "owner", status: "bekliyor", requestedBy: "sahip", userId: "sahip" }).ok).toBe(false);
  });

  it("yönetici olmayan rol (advisor / accounting) karar veremez", () => {
    expect(canDecide({ ...base, role: "advisor" }).ok).toBe(false);
    // accounting commissions'ta tam CRUD'a sahip; kademe kontrolü onu da keser
    expect(canDecide({ ...base, role: "accounting" }).ok).toBe(false);
  });

  it("sonuçlanmış talebe tekrar karar verilemez", () => {
    expect(canDecide({ ...base, status: "onaylandi" }).ok).toBe(false);
    expect(canDecide({ ...base, status: "iptal" }).ok).toBe(false);
  });
});

describe("waitingLabel / averageDecisionHours", () => {
  it("bekleme süresini dk/saat/gün olarak yazar", () => {
    const now = 1_800_000_000_000;
    expect(waitingLabel(new Date(now - 30 * 60_000), now)).toBe("30 dk bekliyor");
    expect(waitingLabel(new Date(now - 3 * HOUR), now)).toBe("3 saat bekliyor");
    expect(waitingLabel(new Date(now - 50 * HOUR), now)).toBe("2 gün bekliyor");
  });

  it("ortalama karar süresi: kararsız satırları saymaz, hiç karar yoksa null", () => {
    expect(averageDecisionHours([{ created_at: "2026-07-01T00:00:00Z", decided_at: null }])).toBeNull();
    const avg = averageDecisionHours([
      { created_at: "2026-07-01T00:00:00Z", decided_at: "2026-07-01T02:00:00Z" }, // 2 sa
      { created_at: "2026-07-01T00:00:00Z", decided_at: "2026-07-01T06:00:00Z" }, // 6 sa
      { created_at: "2026-07-02T00:00:00Z", decided_at: null },
    ]);
    expect(avg).toBe(4);
  });
});
