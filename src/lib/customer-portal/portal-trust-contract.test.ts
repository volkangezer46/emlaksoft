import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { topPortalReasons } from "./portal-model";
import { DEMAND_STATUS_TR } from "@/app/app/talepler/demand-list-logic";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("müşteri portalı güven sözleşmesi", () => {
  it("arayış durumları Türkçe etikete eşlenir", () => {
    expect(DEMAND_STATUS_TR.new).toBe("Yeni");
    expect(DEMAND_STATUS_TR.active).toBe("Aktif");
    expect(DEMAND_STATUS_TR.matched).toBe("Eşleşti");
  });

  it("sayfa kaynağında ölü DEMAND_TYPE_LABELS yok, durum DEMAND_STATUS_TR ile gelir", () => {
    const src = read("src/app/musteri-portali/[token]/page.tsx");
    expect(src).not.toContain("DEMAND_TYPE_LABELS");
    expect(src).toContain("DEMAND_STATUS_TR");
  });

  it("gerekçeler en çok 3, hepsi hesaplanmış ve uyan; yoksa boş dizi", () => {
    const out = topPortalReasons([
      { label: "İl", ok: true, weight: 15 },
      { label: "Bütçe", ok: true, weight: 20 },
      { label: "Oda", ok: false, weight: 10 },
      { label: "m² (belirsiz)", ok: true, weight: 4 },
      { label: "Portföy türü", ok: true, weight: 15, unknown: true },
      { label: "İşlem türü", ok: true, weight: 25 },
      { label: "İlçe", ok: true, weight: 10 },
    ]);
    expect(out).toEqual(["İşlem türü", "Bütçe", "İl"]);
    expect(topPortalReasons([{ label: "Oda", ok: false, weight: 10 }])).toEqual([]);
    expect(topPortalReasons([])).toEqual([]);
  });

  it("portal ve malik paneli 'Veriler ... itibarıyla' notunu clock ile taşır", () => {
    expect(read("src/components/public/portal-kit.tsx")).toContain("Veriler {asOf} itibarıyla");
    for (const f of ["src/app/musteri-portali/[token]/page.tsx", "src/app/malik-portali/[token]/page.tsx"]) {
      const src = read(f);
      expect(src).toContain("asOf={formatDateTimeTr(clockNow())}");
      expect(src).not.toMatch(/new Date\(\)|Date\.now\(\)/);
    }
  });
});
