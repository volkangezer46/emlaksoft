import { describe, expect, it } from "vitest";
import { assessPhoto, formatDims, suggestCover } from "./photo-quality";

describe("fotoğraf kalitesi", () => {
  it("kabul: düşük çözünürlüklü fotoğrafa uyarı çıkar", () => {
    const q = assessPhoto({ width: 640, height: 480 });
    expect(q.known).toBe(true);
    expect(q.issues).toContain("low_resolution");
    expect(q.warning).toMatch(/^Düşük çözünürlük \(640×480\)/);
  });

  it("yeterli yatay fotoğrafa uyarı yok; dikey ve panorama ayrı uyarı", () => {
    expect(assessPhoto({ width: 2048, height: 1536 }).warning).toBeNull();
    expect(assessPhoto({ width: 1536, height: 2048 }).issues).toEqual(["portrait"]);
    expect(assessPhoto({ width: 6000, height: 1500 }).issues).toEqual(["panorama"]);
  });

  it("boyutu bilinmeyen görselde uyarı üretilmez", () => {
    expect(assessPhoto({ width: null, height: undefined })).toMatchObject({ known: false, warning: null });
    expect(formatDims({ width: null, height: 10 })).toBeNull();
  });

  it("kapak önerisi: sorunlu kapak yerine en net yatay görsel; sorunsuz kapakta öneri yok", () => {
    const items = [
      { id: "a", is_cover: true, width: 800, height: 600 },
      { id: "b", width: 1536, height: 2048 },
      { id: "c", width: 1920, height: 1080 },
      { id: "d", width: 1280, height: 960 },
      { id: "e", width: null, height: null },
    ];
    expect(suggestCover(items)).toMatchObject({ id: "c" });
    expect(suggestCover(items)?.reason).toMatch(/düşük çözünürlüklü/);
    expect(suggestCover([{ id: "x", is_cover: true, width: 2000, height: 1500 }, { id: "y", width: 4000, height: 3000 }])).toBeNull();
    // ölçülmemiş kapak: veri yok → öneri yok
    expect(suggestCover([{ id: "x", is_cover: true, width: null, height: null }, { id: "y", width: 4000, height: 3000 }])).toBeNull();
    expect(suggestCover([{ id: "y", width: 4000, height: 3000 }])?.reason).toMatch(/Kapak seçilmemiş/);
  });
});
