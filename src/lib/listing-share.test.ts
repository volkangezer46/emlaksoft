import { describe, expect, it } from "vitest";
import { buildShareText, pickSharePhotoIds, shareFileExt } from "./listing-share";

describe("listing-share (MP7)", () => {
  it("tek portföyde ilk N görsel, sırayı korur", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ id: `m${i}`, property_id: "p1" }));
    expect(pickSharePhotoIds(rows, ["p1"])).toEqual(rows.slice(0, 10).map((r) => r.id));
  });

  it("çok portföyde önce her portföyün kapağı (sırayla), sonra ikinci tur", () => {
    const rows = [
      { id: "a1", property_id: "A" },
      { id: "a2", property_id: "A" },
      { id: "b1", property_id: "B" },
      { id: "c1", property_id: "C" },
      { id: "c2", property_id: "C" },
    ];
    expect(pickSharePhotoIds(rows, ["C", "A", "B", "X"], 4)).toEqual(["c1", "a1", "b1", "c2"]);
  });

  it("paylaşım metni bağlantıyı metne gömer", () => {
    expect(buildShareText({ text: "Kadıköy 3+1", url: "https://x.test/i" })).toBe("Kadıköy 3+1\n\nhttps://x.test/i");
    expect(buildShareText({ text: "  ", url: null })).toBe("");
    expect(shareFileExt("image/webp")).toBe("webp");
    expect(shareFileExt("image/jpeg")).toBe("jpg");
  });
});
