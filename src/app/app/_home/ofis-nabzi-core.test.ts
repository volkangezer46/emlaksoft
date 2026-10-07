import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAdvisorWarnings, crmChangeItems, nonZero } from "./ofis-nabzi-core";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("ofis nabzı", () => {
  it("CRM değişimleri yalnız sıfırdan büyükse ve ?eklenen=1 süzgecine gider; okunamayan (null) çizilmez", () => {
    expect(crmChangeItems({ newDemands: 3, newProperties: 0 })).toEqual([
      { key: "talep", label: "Yeni talep", value: 3, href: "/app/talepler?status=all&eklenen=1" },
    ]);
    expect(crmChangeItems({ newDemands: null, newProperties: 2 })[0]!.href).toBe("/app/portfoyler?eklenen=1");
    expect(nonZero([{ value: 0 }, { value: 2 }])).toEqual([{ value: 2 }]);
  });

  it("danışman uyarıları: gerçek sayımlar, ağırlıkla sıralı, her çip danışmanla süzülmüş listeye gider", () => {
    const rows = buildAdvisorWarnings({
      advisors: [
        { id: A, name: "Ali" },
        { id: B, name: "Banu" },
      ],
      overdueTasks: [A, A, A, null],
      staleDeals: [B],
      slaBreaches: [B],
      staleDays: 14,
    });
    expect(rows.map((r) => r.name)).toEqual(["Banu", "Ali"]);
    expect(rows[0]!.chips.map((c) => c.href)).toEqual([
      `/app/ilan-kontrol/anomaliler?danisman=${B}`,
      `/app/anlasmalar?bayat=1&danisman=${B}`,
    ]);
    expect(rows[1]!.chips[0]).toMatchObject({ signal: "gorev", count: 3, href: `/app/gorevler?filter=overdue&danisman=${A}` });
    expect(rows[1]!.href).toBe(`/app/ekip/${A}`);
  });

  it("sinyali olmayan danışman listelenmez; okunamayan sinyal sahte sıfır üretmez", () => {
    expect(buildAdvisorWarnings({ advisors: [{ id: A, name: "Ali" }], overdueTasks: null, staleDeals: null, slaBreaches: null, staleDays: 14 })).toEqual([]);
  });

  it("hedef listeler 24 saat penceresini (eklenen=1) tanır", () => {
    expect(readFileSync("src/app/app/talepler/demands-view.tsx", "utf8")).toMatch(/ADDED_WINDOWS = \[1, 7, 30, 90\]/);
    expect(readFileSync("src/app/app/portfoyler/page.tsx", "utf8")).toMatch(/ADDED_WINDOWS = \[1, 7, 28, 90\]/);
  });
});
