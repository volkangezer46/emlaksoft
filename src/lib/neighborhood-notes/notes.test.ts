import { describe, expect, it } from "vitest";
import { countByTag, isMissingTableError, noteTagLabel, parseTagFilter, validateNoteInput } from "./notes";

const NB = "11111111-1111-1111-1111-111111111111";

describe("validateNoteInput", () => {
  it("geçerli notu kabul eder, etiketleri tekilleştirir ve bilinmeyeni atar", () => {
    const r = validateNoteInput({ neighborhoodId: NB, tags: ["okul", "okul", "uydurma", "gurultu"], body: "  Ana cadde gürültülü.  " });
    expect(r).toEqual({ ok: true, value: { neighborhoodId: NB, tags: ["okul", "gurultu"], body: "Ana cadde gürültülü." } });
  });

  it("mahalle yoksa veya UUID değilse reddeder", () => {
    expect(validateNoteInput({ neighborhoodId: "", body: "yeterli not" })).toEqual({ ok: false, error: "Önce bir mahalle seçin." });
    expect(validateNoteInput({ neighborhoodId: "abc", body: "yeterli not" }).ok).toBe(false);
  });

  it("çok kısa ve çok uzun notu reddeder", () => {
    expect(validateNoteInput({ neighborhoodId: NB, body: "ab" }).ok).toBe(false);
    expect(validateNoteInput({ neighborhoodId: NB, body: "x".repeat(2001) }).ok).toBe(false);
    expect(validateNoteInput({ neighborhoodId: NB, body: "x".repeat(2000) }).ok).toBe(true);
  });

  it("etiket dizisi olmayan girdi boş etiketle geçer", () => {
    const r = validateNoteInput({ neighborhoodId: NB, tags: "okul", body: "yeterli not" });
    expect(r.ok && r.value.tags).toEqual([]);
  });
});

describe("etiket yardımcıları", () => {
  it("parseTagFilter yalnız bilinen etiketi döner", () => {
    expect(parseTagFilter("okul")).toBe("okul");
    expect(parseTagFilter("x")).toBeNull();
    expect(parseTagFilter(undefined)).toBeNull();
  });

  it("etiket sayaçları", () => {
    const c = countByTag([{ tags: ["okul", "ulasim"] }, { tags: ["okul"] }, { tags: [] }]);
    expect(c.okul).toBe(2);
    expect(c.ulasim).toBe(1);
    expect(c.gurultu).toBe(0);
  });

  it("Türkçe etiket adı", () => {
    expect(noteTagLabel("yatirim")).toBe("Yatırım potansiyeli");
    expect(noteTagLabel("dikkat")).toBe("Dikkat edilecekler");
  });
});

describe("isMissingTableError", () => {
  it("tablo yok hatalarını tanır", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError({ message: "Could not find the table 'public.neighborhood_notes' in the schema cache" })).toBe(true);
    expect(isMissingTableError({ code: "23505" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
