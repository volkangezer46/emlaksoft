import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heroContextLabel, homeLayoutFor, homeVariantOf, isNewOffice, NEW_OFFICE_DAYS, showNewOfficeHero, showsSalesBlocks } from "./home-layout";

const ROLES = ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"] as const;

describe("homeVariantOf", () => {
  it("rolleri beş yerleşime eşler", () => {
    expect(homeVariantOf("owner")).toBe("management");
    expect(homeVariantOf("gm")).toBe("management");
    expect(homeVariantOf("branch_manager")).toBe("management");
    expect(homeVariantOf("team_lead")).toBe("team_lead");
    expect(homeVariantOf("advisor")).toBe("advisor");
    expect(homeVariantOf("accounting")).toBe("accounting");
    expect(homeVariantOf("call_center")).toBe("call_center");
  });
  it("bilinmeyen/boş rol danışman yerleşimine düşer (en az yetkili)", () => {
    expect(homeVariantOf("readonly")).toBe("advisor");
    expect(homeVariantOf(undefined)).toBe("advisor");
    expect(homeVariantOf("???")).toBe("advisor");
  });
});

describe("homeLayoutFor rol matrisi", () => {
  // Sadeleştirme planı 2.4 / C08 (bilinçli güncelleme): yönetimin odağı "Patron panosu"; program artık kendi ilk ekran
  // satırında (alt blok değil), görev bloğu yönetimin "Bugün"ünde yok (gecikmiş görev Ofis özeti > dikkat listesinde).
  it("yönetim: patron panosu odağı + (katlı) dikkat listesi, gelir eğrisi, ekip tablosu, ofis hunisi, ofis/ben anahtarı", () => {
    const l = homeLayoutFor("owner");
    expect(l).toMatchObject({ focus: "patron", attention: true, revenueChart: true, team: true, funnelTarget: "office", scopeSwitch: true, callList: false, auditLink: true });
    expect(l.metrics).toEqual(["ciro", "aktif-anlasma", "yeni-talep", "yeni-musteri", "arama"]);
    expect(l.bottom).toEqual([]);
  });
  // C07 (bilinçli güncelleme): danışmanın aranacakları "Bugünüm" listesinde; ayrı "Bugün ara" tablosu (callList) yalnız
  // arama merkezinde. Program/görev blokları da "Bugünüm" listesine katıldı.
  it("danışman: Bugünüm odağı, kişisel hedef (Özetim'de); ayrı arama tablosu, ekip/dikkat/denetim YOK", () => {
    const l = homeLayoutFor("advisor");
    expect(l).toMatchObject({ focus: "bugunum", callList: false, team: false, attention: false, funnelTarget: null, scopeSwitch: false, auditLink: false });
    expect(l.bottom).toEqual(["kisisel-hedef"]);
  });
  it("takım lideri: danışman yerleşimi + ekip satırı", () => {
    const l = homeLayoutFor("team_lead");
    const a = homeLayoutFor("advisor");
    expect(l.team).toBe(true);
    expect(l.focus).toBe(a.focus);
    expect(l.callList).toBe(false);
  });
  it("muhasebe: tahsilat odağı; satış/müşteri blokları ve arama listesi YOK", () => {
    const l = homeLayoutFor("accounting");
    expect(l.focus).toBe("collections");
    expect(showsSalesBlocks(l)).toBe(false);
    expect(l).toMatchObject({ team: false, callList: false, funnelTarget: null, attention: false });
    expect(l.metrics).toEqual(["tahsil-edilen", "geciken-kira"]);
    expect(l.bottom).toEqual(["gider-ozeti"]);
    expect(l.more).toEqual([]);
  });
  it("arama merkezi: yalnız arama/yanıt süresi odaklı sade yerleşim", () => {
    const l = homeLayoutFor("call_center");
    expect(l.focus).toBe("calls");
    expect(showsSalesBlocks(l)).toBe(false);
    expect(l.metrics).toEqual(["arama", "yanit-suresi", "gorev"]);
    expect(l.team).toBe(false);
    expect(l.more).toEqual([]);
  });
  it("her rolde bir metrik ekranda bir kez (yineleme yok) ve en çok 6 KPI", () => {
    for (const r of ROLES) {
      const l = homeLayoutFor(r);
      expect(new Set(l.metrics).size, r).toBe(l.metrics.length);
      expect(l.metrics.length, r).toBeLessThanOrEqual(6);
      expect(new Set(l.bottom).size, r).toBe(l.bottom.length);
    }
  });
  it("Dikkat listesindeki kalemler KPI'da tekrarlanmaz; danışmana teyit metriği yok", () => {
    for (const r of ROLES) {
      const l = homeLayoutFor(r);
      expect(l.metrics as string[], r).not.toContain("teyit");
      if (l.attention) expect(l.metrics, r).not.toContain("bekleyen-komisyon");
    }
    expect(homeLayoutFor("owner").more as string[]).not.toContain("kuyruk");
  });
  it("ilan olguları TEK 'İlan sağlığı' bloğunda: satış rolleri görür, muhasebe/arama merkezi görmez; eski parçalı bloklar yok", () => {
    for (const r of ["owner", "gm", "branch_manager", "team_lead", "advisor", "readonly"]) expect(homeLayoutFor(r).listingHealth, r).toBe(true);
    for (const r of ["accounting", "call_center"]) expect(homeLayoutFor(r).listingHealth, r).toBe(false);
    for (const r of ROLES) {
      const l = homeLayoutFor(r);
      for (const gone of ["risk", "yetki", "portal-sagligi", "hizli"]) {
        expect([...l.bottom, ...l.more] as string[], `${r}:${gone}`).not.toContain(gone);
      }
    }
  });
  it("her çağrı bağımsız kopya döner (dış mutasyon yerleşimi bozmaz)", () => {
    const a = homeLayoutFor("owner");
    a.metrics.pop();
    expect(homeLayoutFor("owner").metrics).toHaveLength(5);
  });
  it("ilk yük bütçesi: ana ekran `ui/motion` barrel'ını içe aktarmaz (Reveal/MotionProvider motion çekirdeğini ~19 KB ekler; ölçüm 2026-10-06)", () => {
    for (const f of ["src/app/app/(bugun)/page.tsx", "src/app/app/_home/kurumsal/blocks.tsx", "src/app/app/_home/kurumsal/views.tsx", "src/app/app/_home/metrik-seridi.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+["']@\/components\/ui\/motion["']/);
    }
  });
  it("hero bağlam etiketi role ve kapsama göre", () => {
    expect(heroContextLabel(homeLayoutFor("owner"), true)).toBe("Ofis geneli");
    expect(heroContextLabel(homeLayoutFor("owner"), false)).toBe("Benim işlerim");
    expect(heroContextLabel(homeLayoutFor("accounting"), false)).toBe("Tahsilat özeti");
  });
});

describe("yeni ofis kahramanı (plan 2.4: ilk 14 gün ya da kurulum bitene kadar)", () => {
  const DAY = 86_400_000;
  const nowMs = Date.UTC(2026, 9, 16, 9);
  const iso = (daysAgo: number) => new Date(nowMs - daysAgo * DAY).toISOString();
  it("ofis yaşı: 0..14 gün yeni; daha eski, gelecek tarih ya da okunamayan an yeni değil", () => {
    expect(NEW_OFFICE_DAYS).toBe(14);
    expect(isNewOffice(iso(0), nowMs)).toBe(true);
    expect(isNewOffice(iso(14), nowMs)).toBe(true);
    expect(isNewOffice(iso(15), nowMs)).toBe(false);
    expect(isNewOffice(iso(-1), nowMs)).toBe(false);
    expect(isNewOffice(null, nowMs)).toBe(false);
    expect(isNewOffice("bozuk", nowMs)).toBe(false);
  });
  it("yalnız yönetimde, yeni ofiste ve kurulum bitmemişken; durum okunamazsa gösterilmez", () => {
    expect(showNewOfficeHero({ variant: "management", createdAt: iso(3), nowMs, settled: false })).toBe(true);
    expect(showNewOfficeHero({ variant: "management", createdAt: iso(3), nowMs, settled: true })).toBe(false);
    expect(showNewOfficeHero({ variant: "management", createdAt: iso(3), nowMs, settled: null })).toBe(false);
    expect(showNewOfficeHero({ variant: "management", createdAt: iso(30), nowMs, settled: false })).toBe(false);
    expect(showNewOfficeHero({ variant: "advisor", createdAt: iso(3), nowMs, settled: false })).toBe(false);
  });
});
