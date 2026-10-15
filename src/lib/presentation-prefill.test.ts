import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePortfoyParam, PRESENTATION_MAX_PROPERTIES, PRESENTATION_PREFILL_CAP, presentationHref, topPresentableIds } from "./presentation-prefill";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("sunum ön dolgusu ?portfoy=a,b,c", () => {
  it("virgüllü ve tekrarlı parametre; geçersizler atılır, tekillenir, sıra korunur", () => {
    expect(parsePortfoyParam(`${id(2)}, ${id(1)},bad,${id(2)}`)).toEqual([id(2), id(1)]);
    expect(parsePortfoyParam([id(1), `${id(3)},${id(1)}`])).toEqual([id(1), id(3)]);
    expect(parsePortfoyParam(undefined)).toEqual([]);
    expect(parsePortfoyParam("x' or 1=1")).toEqual([]);
    expect(parsePortfoyParam(id(1).toUpperCase())).toEqual([id(1)]);
  });

  it("en çok 20 kimlik okunur", () => {
    const many = Array.from({ length: 30 }, (_, i) => id(i + 1)).join(",");
    expect(parsePortfoyParam(many)).toHaveLength(PRESENTATION_PREFILL_CAP);
  });

  it("bağlantı: virgüllü, sunum sınırıyla kırpılmış, müşteri doğrulanmış", () => {
    const href = presentationHref([id(1), id(2), id(1)], id(9));
    expect(href).toBe(`/app/portfoyler/sunumlar/yeni?portfoy=${id(1)},${id(2)}&musteri=${id(9)}`);
    const capped = presentationHref(Array.from({ length: 8 }, (_, i) => id(i + 1)));
    expect(capped.split("portfoy=")[1].split(",")).toHaveLength(PRESENTATION_MAX_PROPERTIES);
    expect(presentationHref([id(1)], "bozuk")).not.toContain("musteri");
  });

  it("en iyi eşleşmelerden yalnız yayındaki portföyler, tekil, sınırla", () => {
    const pairs = [
      { property: { id: "a", status: "live" } },
      { property: { id: "b", status: "draft" } },
      { property: { id: "a", status: "live" } },
      { property: { id: "c", status: "Yayında" } },
    ];
    expect(topPresentableIds(pairs)).toEqual(["a", "c"]);
    expect(topPresentableIds(pairs, 1)).toEqual(["a"]);
  });

  it("sınır createPresentation ile aynı; sayfa ve bileşenler ortak ayrıştırıcıyı kullanır", () => {
    expect(readFileSync("src/app/actions/presentations.ts", "utf8")).toContain(`MAX_PRESENTATION_PROPERTIES = ${PRESENTATION_MAX_PROPERTIES}`);
    expect(readFileSync("src/app/app/portfoyler/sunumlar/yeni/page.tsx", "utf8")).toContain("parsePortfoyParam(params.portfoy)");
    expect(readFileSync("src/app/app/talepler/match-selection.tsx", "utf8")).toContain("presentationHref(");
    expect(readFileSync("src/app/app/musteriler/[id]/matched-properties-widget.tsx", "utf8")).toContain("presentationHref(presentIds, customerId)");
  });
});
