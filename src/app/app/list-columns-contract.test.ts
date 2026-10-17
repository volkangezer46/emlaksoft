import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * F5 / F9 / F10 (ui): 1366 masaüstünde liste ve detay yerleşimi.
 *  - Müşteriler: "Son temas" sütunu yalnız 2xl'de (1366'da yapışkan eylem hücresinin altında kırpılıyordu); değer adın altında.
 *  - Portföyler: başlık xl ve üstünde genişlikle büyür.
 *  - Portföy detayı: sekme şeridi lg'de sarılır, atama seçici ile "Ata" aynı yükseklik, konum satırı tekilleştirilir.
 */
const read = (f: string) => readFileSync(f, "utf8");

describe("1366 list/detail layout contracts", () => {
  it("F5: Son temas column only from 2xl; shown under the name between md and 2xl", () => {
    const src = read("src/app/app/musteriler/customer-rows.tsx");
    expect(src).toContain('<TH className="hidden 2xl:table-cell">Son temas</TH>');
    expect(src).toContain('<TD stackHide className="hidden text-text-muted 2xl:table-cell">');
    expect(src).not.toMatch(/hidden lg:table-cell">Son temas/);
    expect(src).toContain('className="mt-0.5 hidden truncate text-xs text-text-muted md:block 2xl:hidden"');
  });

  it("F9: portfolio title is flexible at xl+", () => {
    expect(read("src/app/app/portfoyler/property-rows.tsx")).toContain("xl:max-w-[clamp(14rem,26vw,32rem)]");
  });

  it("F10: tabs wrap at lg, assign controls share one height, location parts deduped", () => {
    const page = read("src/app/app/portfoyler/[id]/page.tsx");
    expect(page).toContain('className="lg:[&>ul]:flex-wrap lg:[&>ul]:overflow-visible"');
    expect(page).toContain("const parts = propertyLocationParts(property.address_line, district, province);");
    expect(page).not.toContain("[property.address_line, district, province].filter(Boolean)");
    expect(read("src/components/app/detail-tabs.tsx")).toContain("className={className}");
    const assign = read("src/app/app/portfoyler/[id]/property-admin-actions.tsx");
    expect(assign).toContain('className="h-9 w-auto min-w-[10rem]');
    expect(assign).toContain('className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-white/10');
  });
});
