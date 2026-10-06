import { describe, expect, it } from "vitest";
import { KPI_KEYS } from "@/lib/listing-control/types";
import {
  CONTROL_BASE,
  buildChangeLines,
  buildCriticalJobs,
  buildExecutiveSummary,
  buildKpiCards,
  buildMismatchBreakdown,
  decodeCursor,
  durationLabel,
  emptySummary,
  encodeCursor,
  healthyPercent,
  isKpiKey,
  kpiHref,
  parseAnomalyType,
  parseGroupParam,
  riskLabel,
  scopeOfGroup,
  slaCountdown,
  sumSummaryRows,
  type SummaryNumbers,
} from "./helpers";

const S: SummaryNumbers = { total_active: 100, in_portals: 92, awaiting_publish: 3, portal_missing: 5, price_mismatch: 2, in_review: 4, unverifiable: 1, healthy: 93 };

describe("KPI -> adres (sıfır çıkmaz metrik)", () => {
  it("her KPI anahtarı filtreli listeye gider; ofis kırılımında ek parametre yok", () => {
    for (const k of KPI_KEYS) expect(kpiHref(k)).toBe(`${CONTROL_BASE}/liste?kpi=${k}`);
  });

  it("kırılım ve grup kimliği adrese taşınır", () => {
    expect(kpiHref("portal_missing", "danisman", "abc")).toBe(`${CONTROL_BASE}/liste?kpi=portal_missing&gruplama=danisman&grup=abc`);
  });

  it("kartların tamamı href taşır ve değerleri özetle birebir aynıdır", () => {
    const cards = buildKpiCards(S);
    expect(cards.length).toBe(7);
    for (const c of cards) expect(c.href.startsWith(`${CONTROL_BASE}/liste?kpi=`)).toBe(true);
    expect(cards.find((c) => c.key === "portal_missing")?.value).toBe(5);
    expect(cards.find((c) => c.key === "active")?.value).toBe(100);
  });

  it("geçersiz kpi anahtarı reddedilir", () => {
    expect(isKpiKey("healthy")).toBe(true);
    expect(isKpiKey("x")).toBe(false);
    expect(isKpiKey(undefined)).toBe(false);
  });
});

describe("gruplama", () => {
  it("URL parametresi ofis|sube|takim|danisman; bilinmeyen değer ofise düşer", () => {
    expect(parseGroupParam("sube")).toBe("sube");
    expect(parseGroupParam(["takim", "x"])).toBe("takim");
    expect(parseGroupParam("zzz")).toBe("ofis");
    expect(parseGroupParam(undefined)).toBe("ofis");
  });

  it("kapsam türüne eşlenir (RLS tarafı aynı türleri kullanır)", () => {
    expect(scopeOfGroup("ofis")).toBe("tenant");
    expect(scopeOfGroup("sube")).toBe("branch");
    expect(scopeOfGroup("takim")).toBe("team");
    expect(scopeOfGroup("danisman")).toBe("advisor");
  });

  it("grup satırları toplanır ve oran toplamdan hesaplanır", () => {
    const sum = sumSummaryRows([S, { ...S, total_active: 50, healthy: 25 }]);
    expect(sum.total_active).toBe(150);
    expect(sum.healthy).toBe(118);
    expect(healthyPercent(sum)).toBe(79);
    expect(healthyPercent(emptySummary())).toBeNull();
  });
});

describe("kural tabanlı yönetici özeti", () => {
  it("gerçek sayılardan cümle üretir", () => {
    const text = buildExecutiveSummary(S, { overdueSla: 2 }).join(" ");
    expect(text).toContain("Bugün 100 aktif portföy var");
    expect(text).toContain("5 tanesinde portal ilanı kayıp");
    expect(text).toContain("%93");
    expect(text).toContain("3 portföy danışmana verildi ancak yayınlanmadı");
    expect(text).toContain("2 uyarının süresi geçti");
  });

  it("veri yoksa sahte sayı üretmez", () => {
    expect(buildExecutiveSummary(null)).toEqual(["İlan kontrol verisi henüz etkin değil; sayı üretilemedi."]);
    expect(buildExecutiveSummary(emptySummary())).toEqual(["Kontrol kapsamında aktif portföy yok."]);
  });

  it("sorun yoksa müdahale gerekmediğini söyler", () => {
    const clean = { ...emptySummary(), total_active: 10, in_portals: 10, healthy: 10 };
    expect(buildExecutiveSummary(clean).join(" ")).toContain("müdahale gerektiren sorun görünmüyor");
  });
});

describe("kritik işler ve kırılım", () => {
  it("yalnız sıfırdan büyük sayılar listelenir ve filtreli kuyruğa gider", () => {
    const jobs = buildCriticalJobs({ portal_missing: 5, not_published: 3, price_mismatch: 0, authority_expiring: 1 }, 4);
    expect(jobs.map((j) => j.label)).toEqual([
      "5 portal ilanı kayıp",
      "3 aktif portföy yayınlanmamış",
      "1 yetkisiz veya yetkisi bitiyor",
      "4 portföyde açıklama bekleniyor",
    ]);
    expect(jobs[0]?.href).toBe(`${CONTROL_BASE}/anomaliler?tur=portal_missing`);
    expect(jobs.at(-1)?.href).toBe(kpiHref("in_review"));
  });

  it("100 aktif / 92 portalda -> 8 fark ve kalemler", () => {
    const m = buildMismatchBreakdown(S, { advisor_mismatch: 2 });
    expect(m.difference).toBe(8);
    expect(m.parts.find((p) => p.key === "awaiting_publish")?.count).toBe(3);
    expect(m.parts.find((p) => p.key === "advisor_mismatch")?.count).toBe(2);
    expect(m.other).toBe(0);
    expect(m.parts.every((p) => p.href.startsWith(CONTROL_BASE))).toBe(true);
  });

  it("açıklanamayan fark 'diğer' olarak ayrılır; negatif fark üretilmez", () => {
    expect(buildMismatchBreakdown({ ...S, awaiting_publish: 0, portal_missing: 0 }, {}).other).toBe(8);
    expect(buildMismatchBreakdown({ ...S, total_active: 10, in_portals: 12 }, {}).difference).toBe(0);
  });

  it("değişen satırlarının hepsi tıklanabilir hedefe sahiptir", () => {
    const lines = buildChangeLines({ anomalies_opened: 1, anomalies_closed: 2, newly_missing: 3, recovered: 4, checks_total: 5, checks_unverifiable: 6 });
    expect(lines).toHaveLength(6);
    for (const l of lines) expect(l.href.startsWith(CONTROL_BASE)).toBe(true);
  });
});

describe("risk, SLA ve imleç", () => {
  it("risk etiketi", () => {
    expect(riskLabel(87).label).toBe("Yüksek");
    expect(riskLabel(95).level).toBe("critical");
    expect(riskLabel(10).label).toBe("Düşük");
    expect(riskLabel(null).label).toBe("Ölçülmedi");
  });

  it("SLA geri sayımı: kalan ve geciken", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(slaCountdown("2026-10-06T14:30:00Z", now)).toEqual({ label: "2 sa 30 dk kaldı", overdue: false });
    expect(slaCountdown("2026-10-06T10:00:00Z", now)).toEqual({ label: "2 sa 0 dk gecikti", overdue: true });
    expect(slaCountdown("2026-10-01T12:00:00Z", now)?.label).toBe("5 gün gecikti");
    expect(slaCountdown(null, now)).toBeNull();
  });

  it("keyset imleci gidiş-dönüş yapar; bozuk imleç reddedilir", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(decodeCursor(encodeCursor({ riskScore: 87, propertyId: id }) ?? undefined)).toEqual({ riskScore: 87, propertyId: id });
    expect(decodeCursor("999~abc")).toBeNull();
    expect(decodeCursor("x~y")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it("tür filtresi yalnız bilinen türleri kabul eder", () => {
    expect(parseAnomalyType("portal_missing")).toBe("portal_missing");
    expect(parseAnomalyType("drop table")).toBeNull();
  });

  it("süre etiketi", () => {
    expect(durationLabel(null)).toBe("-");
    expect(durationLabel(5)).toBe("5 saat");
    expect(durationLabel(72)).toBe("3 gün");
  });
});
