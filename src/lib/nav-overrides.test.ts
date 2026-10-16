import { describe, expect, it } from "vitest";
import { hubNav } from "./nav-config";
import { NAV_BY_ROLE, REQUIRED_HUB_IDS, applyNavOverride, navLayoutFor, pageKey } from "./nav-roles";
import { parseMenuOverrides, serializeMenuOverrides } from "./nav-overrides";
import { DEFAULT_MATRIX, canAccessModule, type AppModule, type AppRole } from "./permissions";

/**
 * MENÜ YÖNETİMİ farkı: varsayılan düzen tek kaynak, fark seyrek; gizle / sırala / yeniden adlandır / grup gizle;
 * zorunlu satırlar korunur; fark yetki ya da paket kuralını AŞAMAZ (yalnız daraltır); bilinmeyen anahtar yok sayılır.
 */
const accessibleOf = (role: AppRole) => (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));
const ids = (role: AppRole, ov?: Parameters<typeof navLayoutFor>[1]) => hubNav(accessibleOf(role), { role, overrides: ov }).hubs.map((h) => h.id);

describe("applyNavOverride (saf)", () => {
  const manager = NAV_BY_ROLE.owner;

  it("fark yoksa aynı düzen nesnesi döner", () => {
    expect(applyNavOverride(manager, null)).toBe(manager);
    expect(navLayoutFor("owner")).toBe(manager);
  });

  it("gizle: merkez ve sayfa gizlenir; zorunlu merkez (Ana Sayfa, Ayarlar) ve ilk sayfaları gizlenemez", () => {
    const out = applyNavOverride(manager, { hidden: ["onaylar", "bugun", "ayarlar", pageKey("ajanda", "/app/gorevler"), pageKey("ayarlar", "/app/ayarlar")] });
    const hubIds = out.hubs.map((h) => h.id);
    expect(hubIds).not.toContain("onaylar");
    expect(hubIds).toContain("bugun");
    expect(out.dock.map((h) => h.id)).toContain("ayarlar");
    expect(out.dock.find((h) => h.id === "ayarlar")!.pages[0]!.href).toBe("/app/ayarlar");
    expect(out.hubs.find((h) => h.id === "ajanda")!.pages.map((p) => p.href)).toEqual(["/app/randevular"]);
    for (const id of REQUIRED_HUB_IDS) expect([...out.hubs, ...out.dock].some((h) => h.id === id), id).toBe(true);
  });

  it("grup gizle: gruptaki tüm satırlar çıkar, diğer gruplar kalır", () => {
    const out = applyNavOverride(manager, { hiddenGroups: ["Satış"] });
    expect(out.hubs.some((h) => h.group === "Satış")).toBe(false);
    expect(out.hubs.some((h) => h.group === "Yönetim")).toBe(true);
  });

  it("sırala: yalnız aynı grup içinde; grup başlıkları dağılmaz", () => {
    const out = applyNavOverride(manager, { order: ["pazarlama", "raporlar", "ekibim", "bugun"] });
    const yonetim = out.hubs.filter((h) => h.group === "Yönetim").map((h) => h.id);
    expect(yonetim).toEqual(["pazarlama", "raporlar", "ekibim"]);
    // Gruplar ardışık kalır (her grup tek blok).
    const groups = out.hubs.map((h) => h.group ?? "-");
    const blocks = groups.filter((g, i) => g !== groups[i - 1]);
    expect(new Set(blocks).size).toBe(blocks.length);
    expect(out.hubs[0]!.id).toBe("bugun");
  });

  it("yeniden adlandır: merkez ve sayfa adı; boş ya da 40 karakterden uzun ad yok sayılır", () => {
    const out = applyNavOverride(manager, { labels: { musteriler: "Müşteri defteri", [pageKey("musteriler", "/app/talepler")]: "Arayışlar", ilanlar: "  ", ajanda: "x".repeat(41) } });
    expect(out.hubs.find((h) => h.id === "musteriler")!.label).toBe("Müşteri defteri");
    expect(out.hubs.find((h) => h.id === "musteriler")!.pages.find((p) => p.href === "/app/talepler")!.label).toBe("Arayışlar");
    expect(out.hubs.find((h) => h.id === "ilanlar")!.label).toBe("Portföyler");
    expect(out.hubs.find((h) => h.id === "ajanda")!.label).toBe("Ajanda");
  });
});

describe("hubNav + fark: yetki ve paket kuralı korunur", () => {
  it("fark yetkisiz sayfayı menüye SOKAMAZ (muhasebede Mülk yönetimi yok; sıra/ad farkı yetki vermez)", () => {
    const ov = { roles: { accounting: { order: ["kiralama", "finans"], labels: { kiralama: "Kiralar" } } } };
    expect(ids("accounting", ov)).not.toContain("kiralama");
    // Danışmana yönetim satırı eklenemez: bilinmeyen kimlik düzende yoktur.
    expect(ids("advisor", { roles: { advisor: { order: ["ekibim", "musteriler"] } } })).not.toContain("ekibim");
  });

  it("yetkisi kaldırılan modül farkla açılmaz", () => {
    const closedNav = hubNav(accessibleOf("owner").filter((m) => m !== "rentals"), { role: "owner", overrides: { roles: { manager: { labels: { kiralama: "Kiralar" } } } } });
    expect(closedNav.hubs.map((h) => h.id)).not.toContain("kiralama");
  });

  it("rol düzeni anahtarı: sahip / genel müdür / şube müdürü aynı farkı alır; danışman ve takım lideri aynı", () => {
    const ov = { roles: { manager: { hidden: ["onaylar"] }, advisor: { hidden: ["komisyon"] } } };
    for (const r of ["owner", "gm", "branch_manager"] as const) expect(ids(r, ov), r).not.toContain("onaylar");
    for (const r of ["advisor", "team_lead"] as const) expect(ids(r, ov), r).not.toContain("komisyon");
    expect(ids("owner", { roles: { advisor: { hidden: ["onaylar"] } } })).toContain("onaylar");
  });

  it("mobil yuva gizlenen merkezi göstermez", () => {
    const m = hubNav(accessibleOf("owner"), { role: "owner", overrides: { roles: { manager: { hidden: ["musteriler"] } } } });
    expect(m.mobile).not.toContain("musteriler");
  });
});

describe("parseMenuOverrides / serializeMenuOverrides", () => {
  it("bozuk değer = boş fark (asla fırlatmaz)", () => {
    for (const raw of ["", "{", "[]", "null", 42, null, undefined, { roles: "x" }]) expect(parseMenuOverrides(raw), String(raw)).toEqual({});
  });

  it("bilinmeyen rol/kimlik/grup atılır; zorunlu gizleme ve varsayılanla aynı ad yazılmaz", () => {
    const out = parseMenuOverrides({
      roles: {
        manager: { hidden: ["onaylar", "bugun", "yok", pageKey("bugun", "/app")], labels: { musteriler: "Müşteriler", ilanlar: "Mülkler", zzz: "a" }, hiddenGroups: ["Satış", "Uydurma"] },
        hacker: { hidden: ["x"] },
      },
      admin: { hiddenGroups: ["destek", "genel", "yok"], groupOrder: ["genel", "ofisler"] },
    });
    expect(out).toEqual({
      roles: { manager: { hidden: ["onaylar"], hiddenGroups: ["Satış"], labels: { ilanlar: "Mülkler" } } },
      admin: { hiddenGroups: ["destek"] },
    });
  });

  it("varsayılanla aynı sıra yazılmaz; boş fark kaydı null (varsayılana dön)", () => {
    const def = NAV_BY_ROLE.owner.hubs.map((h) => h.id);
    expect(parseMenuOverrides({ roles: { manager: { order: def } } })).toEqual({});
    expect(serializeMenuOverrides({})).toBeNull();
    const text = serializeMenuOverrides({ roles: { manager: { hidden: ["onaylar"] } } });
    expect(JSON.parse(text!)).toEqual({ roles: { manager: { hidden: ["onaylar"] } } });
  });
});
