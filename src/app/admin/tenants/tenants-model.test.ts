import { describe, expect, it } from "vitest";
import { activeChips, activityHealth, isFiltered, parseTenantFilters, tenantInventory, tenantsHref, toggleFilter } from "./tenants-model";

const isPlan = (id: string) => ["advisor", "office", "professional", "business", "enterprise"].includes(id);

describe("ofis listesi filtre kontratı (URL ↔ sunucu)", () => {
  it("geçersiz değerleri atar, deneme=bitti için gün penceresi varsayılan 30", () => {
    const f = parseTenantFilters({ durum: "x", plan: "gold", veri: "demo", yeni: "14", deneme: "bitti", sayfa: "0" }, isPlan);
    expect(f).toEqual({ q: undefined, durum: undefined, plan: undefined, veri: "demo", yeni: undefined, deneme: "bitti", gun: "30", dagilim: undefined, sayfa: undefined });
    expect(parseTenantFilters({ durum: "risk", deneme: "bitiyor", gun: "7" }, isPlan)).toMatchObject({ durum: "risk", deneme: "bitiyor", gun: undefined });
  });

  it("href gidiş-dönüş: parse(href) aynı süzgeçleri verir", () => {
    const f = parseTenantFilters({ q: "Kadıköy", durum: "trial", plan: "office", veri: "gercek", yeni: "30", deneme: "bitti", gun: "90", dagilim: "aktif", sayfa: "3" }, isPlan);
    const href = tenantsHref(f);
    const back = parseTenantFilters(Object.fromEntries(new URL(href, "https://x").searchParams), isPlan);
    expect(back).toEqual(f);
  });

  it("süzgeç değiştirmek sayfayı sıfırlar; aynı değer tekrar seçilince kaldırılır; dağılım tabanı süzgeç sayılmaz", () => {
    const f = parseTenantFilters({ durum: "active", sayfa: "4" }, isPlan);
    expect(toggleFilter(f, "plan", "office")).toBe("/admin/tenants?durum=active&plan=office");
    expect(toggleFilter(f, "durum", "active")).toBe("/admin/tenants");
    expect(isFiltered(parseTenantFilters({ dagilim: "aktif" }, isPlan))).toBe(false);
    expect(isFiltered(f)).toBe(true);
  });

  it("çipler kaldırma bağlantısıyla gelir", () => {
    const f = parseTenantFilters({ q: "a", durum: "risk", deneme: "bitti" }, isPlan);
    const chips = activeChips(f, (p) => p, (s) => s);
    expect(chips.map((c) => c.key)).toEqual(["q", "durum", "deneme"]);
    expect(chips[1]!.label).toContain("Riskli");
    expect(chips[2]!.removeHref).toBe("/admin/tenants?q=a&durum=risk");
  });
});

describe("envanter sayımları", () => {
  const t = { nowIso: "2026-10-07T12:00:00.000Z", ago30Iso: "2026-09-07T12:00:00.000Z", in7Iso: "2026-10-14T12:00:00.000Z" };
  it("durum, paket, aktif paket, demo, biten deneme ve 30 gün önceki toplam", () => {
    const inv = tenantInventory(
      [
        { plan: "office", status: "active", sample_seeded_at: null, trial_ends_at: null, created_at: "2026-01-01T00:00:00Z" },
        { plan: "professional", status: "active", sample_seeded_at: null, trial_ends_at: null, created_at: "2026-10-01T00:00:00Z" },
        { plan: "office", status: "trial", sample_seeded_at: "2026-10-02T00:00:00Z", trial_ends_at: "2026-10-10T00:00:00Z", created_at: "2026-10-02T00:00:00Z" },
        { plan: "advisor", status: "suspended", sample_seeded_at: null, trial_ends_at: "2026-09-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
      ],
      t,
    );
    expect(inv.total).toBe(4);
    expect(inv.newLast30).toBe(2);
    expect(inv.totalPrev30).toBe(2);
    expect(inv.byStatus).toEqual({ active: 2, trial: 1, past_due: 0, suspended: 1, cancelled: 0 });
    expect(inv.byPlan).toEqual({ office: 2, professional: 1, advisor: 1 });
    expect(inv.byPlanActive).toEqual({ office: 1, professional: 1 });
    expect(inv.demo).toBe(1);
    expect(inv.trialEnding7).toBe(1);
  });

  it("etkinlik rozeti: sayım yoksa bilinmiyor (uydurma 'hareketsiz' yok)", () => {
    expect(activityHealth(null).label).toBe("Bilinmiyor");
    expect(activityHealth(0).label).toBe("Hareketsiz");
    expect(activityHealth(3).label).toBe("Sessiz");
    expect(activityHealth(12).label).toBe("Etkin");
  });
});
