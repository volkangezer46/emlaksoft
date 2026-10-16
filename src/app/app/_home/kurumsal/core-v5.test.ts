import { describe, expect, it } from "vitest";
import {
  KPI_REQUIRES,
  activityWhen,
  attentionAge,
  attentionMore,
  joinDetail,
  newlyOverdueListings,
  rankAttentionRecords,
  rentDueIso,
  roleHomePlan,
  roleSentenceParts,
  trDayDiff,
  type AttentionRecord,
} from "./core";

// 17 Ekim 2026 14:00 TR (11:00 UTC)
const NOW = Date.UTC(2026, 9, 17, 11);
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const rec = (p: Partial<AttentionRecord> & Pick<AttentionRecord, "key" | "level">): AttentionRecord => ({
  title: p.key,
  detail: null,
  at: null,
  ageKind: "elapsed",
  href: `/x/${p.key}`,
  total: 1,
  ...p,
});

describe("Dikkat: tek kayıt sıralaması", () => {
  it("önce önem, eşitlikte en eski kayıt; yaşı olmayan sonda; en çok 5 satır", () => {
    const rows = [
      rec({ key: "randevu", level: "orta", at: daysAgo(-0.1), ageKind: "slot" }),
      rec({ key: "onay", level: "yuksek", at: daysAgo(1) }),
      rec({ key: "gorev", level: "acil", at: daysAgo(3) }),
      rec({ key: "teyit", level: "yuksek", at: daysAgo(2) }),
      rec({ key: "tahsilat", level: "acil", at: daysAgo(12) }),
      rec({ key: "komisyon", level: "orta", at: null, ageKind: "none" }),
      rec({ key: "pasif", level: "dusuk" }),
    ];
    const { rows: shown, hidden } = rankAttentionRecords(rows);
    expect(shown.map((r) => r.key)).toEqual(["tahsilat", "gorev", "teyit", "onay", "randevu"]);
    expect(hidden).toBe(2);
  });
  it("eşit önem ve yaşsızlıkta giriş sırası korunur; boş girdi", () => {
    const { rows } = rankAttentionRecords([rec({ key: "a", level: "orta" }), rec({ key: "b", level: "orta" })]);
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
    expect(rankAttentionRecords([])).toEqual({ rows: [], hidden: 0 });
  });
});

describe("Dikkat: yaş ve ek metinler", () => {
  it("geçen gün sayısı / bugün / randevu saati", () => {
    expect(attentionAge({ at: daysAgo(12), ageKind: "elapsed" }, NOW)).toBe("12 gün geçti");
    expect(attentionAge({ at: daysAgo(0.1), ageKind: "elapsed" }, NOW)).toBe("Bugün");
    expect(attentionAge({ at: new Date(NOW + 30 * 60_000).toISOString(), ageKind: "slot" }, NOW)).toBe("Bugün 14:30");
    expect(attentionAge({ at: null, ageKind: "none" }, NOW)).toBeNull();
    expect(attentionAge({ at: "bozuk", ageKind: "elapsed" }, NOW)).toBeNull();
  });
  it("+N daha yalnız birden çok kayıtta", () => {
    expect(attentionMore(12)).toBe("+11 daha");
    expect(attentionMore(1)).toBeNull();
    expect(attentionMore(null)).toBeNull();
  });
  it("kira vadesi = dönem + vade günü (TR gece yarısı)", () => {
    expect(rentDueIso("2026-10-01", 5)).toBe("2026-10-04T21:00:00.000Z");
    expect(rentDueIso("2026-10-01", 99)).toBe("2026-10-27T21:00:00.000Z");
    expect(rentDueIso(null, 5)).toBeNull();
  });
  it("alt satır boş parçaları atar", () => {
    expect(joinDetail("Cevahir Residence D-12", null, " Ahmet Yılmaz ")).toBe("Cevahir Residence D-12 · Ahmet Yılmaz");
    expect(joinDetail(null, "")).toBeNull();
  });
  it("takvim günü farkı ve ekip faaliyet zamanı", () => {
    expect(trDayDiff(Date.parse(daysAgo(1)), NOW)).toBe(1);
    expect(activityWhen(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe("13:00");
    expect(activityWhen(daysAgo(1), NOW)).toBe("Dün");
    expect(activityWhen(daysAgo(3), NOW)).toBe("3 gün önce");
  });
  it("son 24 saatte teyit süresi dolan ilan sayısı", () => {
    const rows = [{ last_confirmed_at: daysAgo(7.2) }, { last_confirmed_at: daysAgo(9) }, { last_confirmed_at: daysAgo(2) }];
    expect(newlyOverdueListings(rows, NOW)).toBe(1);
  });
});

describe("rol → ana ekran planı", () => {
  const all = () => true;
  const without = (...mods: string[]) => (m: string) => !mods.includes(m);
  it("her rol 5 kart, kendi paneli ve kategorileri", () => {
    const owner = roleHomePlan("owner", all);
    expect(owner.kpis).toEqual(["ciro", "aktif-anlasma", "yeni-talep", "yeni-musteri", "gelen-arama"]);
    expect(owner.panel).toBe("ofis-durumu");
    expect(roleHomePlan("gm", all).persona).toBe("ofis-yonetimi");
    const branch = roleHomePlan("branch_manager", all);
    expect(branch.kpis).toEqual(["ciro", "aktif-anlasma", "bugunku-randevu", "atanmamis-portfoy", "geciken-gorev"]);
    expect(roleHomePlan("team_lead", all)).toMatchObject({ persona: "takim-lideri", panel: "ekibim" });
    expect(roleHomePlan("team_lead", all).kpis).toEqual(["ekip-kapanis", "ekip-anlasma", "ekip-geciken-gorev", "ekip-randevu", "ekip-yeni-musteri"]);
    const adv = roleHomePlan("advisor", all);
    expect(adv.kpis).toEqual(["kazancim", "hedefime-kalan", "aktif-anlasmam", "bugunku-randevum", "musterilerim"]);
    expect(adv.panel).toBe("benim-gunum");
    expect(adv.attention).not.toContain("pasif");
    expect(adv.attention).not.toContain("tahsilat");
    expect(roleHomePlan("accounting", all).kpis).toEqual(["kasa-banka", "bu-ay-net", "vadesi-gecen", "bu-ay-gider", "incelenecek"]);
    expect(roleHomePlan("accounting", all).panel).toBe("finans-durumu");
    expect(roleHomePlan("call_center", all).kpis).toEqual(["bugun-gelen-arama", "cevapsiz-arama", "yanit-suresi", "bugun-yeni-musteri", "bugun-randevu"]);
    expect(roleHomePlan("call_center", all).attention).toContain("cevapsiz-arama");
  });
  it("her rolün kartları birbirinden farklı (tek düzen herkese değil)", () => {
    const sets = ["owner", "branch_manager", "team_lead", "advisor", "accounting", "call_center"].map((r) => roleHomePlan(r, all).kpis.join(","));
    expect(new Set(sets).size).toBe(sets.length);
  });
  it("yönetim 'Benim işlerim'de kişisel plan; bilinmeyen rol danışman", () => {
    expect(roleHomePlan("owner", all, { scopeMine: true }).persona).toBe("danisman");
    expect(roleHomePlan("readonly", all).persona).toBe("danisman");
    expect(roleHomePlan(null, all).persona).toBe("danisman");
  });
  it("para yetkisi yoksa para kartı çıkar, yerine rolün yedek kartı girer (en çok 5)", () => {
    const adv = roleHomePlan("advisor", without("commissions"));
    expect(adv.kpis).toEqual(["bugunku-randevum", "musterilerim", "geciken-gorev", "yeni-talep"]);
    for (const k of adv.kpis) expect(KPI_REQUIRES[k]).not.toContain("commissions");
    const owner = roleHomePlan("owner", without("commissions"));
    expect(owner.kpis).toEqual(["yeni-talep", "yeni-musteri", "gelen-arama", "bugunku-randevu", "geciken-gorev"]);
    expect(roleHomePlan("accounting", without("expenses")).kpis).toEqual(["bu-ay-komisyon"]);
    expect(roleHomePlan("owner", all).kpis.length).toBeLessThanOrEqual(5);
  });
});

describe("rol bazlı özet cümlesi", () => {
  const text = (p: { text: string }[]) => p.map((x) => x.text).join("");
  it("danışman kendi günü", () => {
    expect(text(roleSentenceParts("danisman", { appointments: 2, tasksDue: 3, callbacks: 1 }))).toBe("Bugün 2 randevunuz, 3 göreviniz ve 1 geri dönüş bekleyen müşteriniz var.");
  });
  it("çağrı merkezi kuyruğu; sıfırlar atlanır", () => {
    expect(text(roleSentenceParts("cagri-merkezi", { callsToday: 12, missedCalls: 0, callbacks: 4 }))).toBe("Bugün 12 gelen arama ve 4 geri dönüş bekleyen talep var.");
    expect(text(roleSentenceParts("cagri-merkezi", {}))).toMatch(/^Bugün henüz arama kaydı yok/);
  });
  it("takım lideri ekibi; yönetim ofis cümlesi", () => {
    expect(text(roleSentenceParts("takim-lideri", { appointments: 5, overdueTasks: 2 }))).toBe("Bugün 5 ekip randevusu ve 2 geciken ekip görevi var.");
    expect(text(roleSentenceParts("ofis-yonetimi", { appointments: 1, demands: 5, listingUpdates: 9 }))).toBe("Bugün 1 randevu, 5 yeni müşteri talebi ve 9 ilan güncellemesi sizi bekliyor.");
  });
  it("sayılar kalın", () => {
    const p = roleSentenceParts("danisman", { appointments: 2 });
    expect(p.filter((x) => x.strong).map((x) => x.text)).toEqual(["2"]);
  });
});
